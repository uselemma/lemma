"""SDK-owned worker pools that keep automatic delivery off the event loop.

Automatic delivery blocks on the transport and on retry backoff. A sync hook
that an async framework calls on its loop thread hands delivery to the
fire-and-forget pool; ``async_trace`` awaits delivery on the awaited pool.
"""

from __future__ import annotations

import asyncio
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor, wait
from contextvars import copy_context
from typing import Callable, Literal

from .delivery import (
    INGEST_MAX_ATTEMPTS,
    INGEST_REQUEST_TIMEOUT_SECONDS,
    INGEST_RETRY_MAX_DELAY_SECONDS,
    still_queued,
)
from .dropped_traces import report_dropped_trace

# Fire-and-forget worker threads. A few keep deliveries from queueing behind
# one stalled send while staying negligible in the host process.
OFF_LOOP_WORKERS = 4
# Fire-and-forget deliveries queued or running at once. Each holds its payload
# for up to the full retry budget, so during a Lemma outage this bounds the
# host's memory; it is far above a normal burst of finished traces.
OFF_LOOP_MAX_BACKLOG = 1_000
# Awaited-delivery worker threads, sized like asyncio's default executor. The
# pool is the SDK's own: the default executor also serves the host's DNS lookups
# and to_thread work, which a stalled delivery would otherwise hold up. During
# an outage, concurrent async_trace deliveries beyond this many queue; each is
# still delivered or reported, and none is lost.
AWAITED_WORKERS = min(32, (os.cpu_count() or 1) + 4)
# One delivery's worst case: every attempt times out and every retry waits the
# longest backoff. Flush and exit wait at most this long for queued deliveries,
# for parity with TypeScript, whose concurrent deliveries all finish within one
# retry budget. A delivery already sending finishes on its own budget, so exit
# can take up to about twice this.
OFF_LOOP_DRAIN_DEADLINE_SECONDS = (
    INGEST_MAX_ATTEMPTS * INGEST_REQUEST_TIMEOUT_SECONDS
    + (INGEST_MAX_ATTEMPTS - 1) * INGEST_RETRY_MAX_DELAY_SECONDS
)


class _Pool:
    """A lazily started executor that tracks each queued or running delivery."""

    def __init__(
        self, workers: int, thread_name_prefix: str, *, max_backlog: int | None = None
    ) -> None:
        self._workers = workers
        self._thread_name_prefix = thread_name_prefix
        self._max_backlog = max_backlog
        self.reset()

    def reset(self) -> None:
        self.lock = threading.Lock()
        self.executor: ThreadPoolExecutor | None = None
        # Each queued or running delivery, with the Lemma trace ID it sends,
        # in submission order.
        self.pending: dict[Future[None], str] = {}

    def submit(self, fn: Callable[[], None], trace_id: str) -> Future[None] | None:
        """Queue ``fn`` to run in the submitting thread's context; None when the
        backlog is full and it is not queued."""
        with self.lock:
            if self._max_backlog is not None and len(self.pending) >= self._max_backlog:
                return None
            if self.executor is None:
                self.executor = ThreadPoolExecutor(
                    max_workers=self._workers,
                    thread_name_prefix=self._thread_name_prefix,
                )
            # Copied here, on the caller's thread, so before_send and a custom
            # transport see the caller's ContextVars on the worker.
            future = self.executor.submit(copy_context().run, fn)
            self.pending[future] = trace_id
        # Outside the lock: a future that already finished runs this at once.
        future.add_done_callback(self._forget)
        return future

    def snapshot(self) -> dict[Future[None], str]:
        with self.lock:
            return dict(self.pending)

    def _forget(self, future: Future[None]) -> None:
        with self.lock:
            self.pending.pop(future, None)


_fire_and_forget = _Pool(
    OFF_LOOP_WORKERS, "uselemma-delivery", max_backlog=OFF_LOOP_MAX_BACKLOG
)
_awaited = _Pool(AWAITED_WORKERS, "uselemma-awaited-delivery")


def on_event_loop_thread() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def submit(fn: Callable[[], None], trace_id: str) -> bool:
    """Queue ``fn`` without waiting; False when the backlog is full and it is not queued."""
    return _fire_and_forget.submit(fn, trace_id) is not None


async def run_awaited(fn: Callable[[], None], trace_id: str) -> None:
    """Run ``fn`` on the awaited pool and wait for it.

    Cancelling the caller, by its own timeout or by ``asyncio.run`` shutting
    down, ends only the wait: nothing links the waiter back to the delivery,
    which still runs or is reported by the exit drain.
    """
    future = _awaited.submit(fn, trace_id)
    assert future is not None, "the awaited pool has no backlog cap"
    loop = asyncio.get_running_loop()
    waiter: asyncio.Future[None] = loop.create_future()

    def wake(done: Future[None]) -> None:
        try:
            loop.call_soon_threadsafe(_settle, waiter, done)
        except RuntimeError:
            # The loop closed while the delivery ran, so nobody is waiting.
            pass

    future.add_done_callback(wake)
    await waiter


def _settle(waiter: asyncio.Future[None], done: Future[None]) -> None:
    if waiter.done():
        return  # The caller stopped waiting.
    error = None if done.cancelled() else done.exception()
    if error is None:
        waiter.set_result(None)
    else:
        waiter.set_exception(error)


def wait_pending() -> None:
    """Wait up to the drain deadline for fire-and-forget deliveries to finish.

    Deliveries that have not started by then are dropped and reported once; a
    delivery already sending finishes or times out on its own.
    """
    _drain([_fire_and_forget], "flush")


def _drain(pools: list[_Pool], moment: Literal["flush", "exit"]) -> None:
    pending: dict[Future[None], str] = {}
    for pool in pools:
        pending.update(pool.snapshot())
    _done, not_done = wait(pending, timeout=OFF_LOOP_DRAIN_DEADLINE_SECONDS)
    # Submission order, so the report names the oldest dropped delivery.
    dropped = [
        trace_id
        for future, trace_id in pending.items()
        if future in not_done and future.cancel()
    ]
    if dropped:
        report_dropped_trace(
            dropped[0], still_queued(len(dropped), moment), count=len(dropped)
        )


def _drain_at_exit() -> None:
    _drain([_fire_and_forget, _awaited], "exit")


def _reset() -> None:
    # A forked child has none of the parent's workers; submitting to an
    # inherited pool would queue work that never runs.
    _fire_and_forget.reset()
    _awaited.reset()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_reset)

# concurrent.futures registers one module-level exit hook,
# concurrent.futures.thread._python_exit, that joins every executor's workers
# after they run all queued work. Hooks run newest first, and this one
# registers after it, so both pools' backlogs are cut to the deadline before
# that join.
if hasattr(threading, "_register_atexit"):
    threading._register_atexit(_drain_at_exit)
