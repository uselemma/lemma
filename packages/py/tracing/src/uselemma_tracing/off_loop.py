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
from functools import partial
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
# Awaited-delivery worker threads, sized like asyncio's default executor so
# concurrent callers don't queue behind each other. The pool is the SDK's own:
# the default executor also serves the host's DNS lookups and to_thread work,
# which a stalled delivery would otherwise hold up.
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

    def __init__(self, workers: Callable[[], int], thread_name_prefix: str) -> None:
        self._workers = workers
        self._thread_name_prefix = thread_name_prefix
        self.reset()

    def reset(self) -> None:
        # Reentrant: a done callback runs at once on the submitting thread when
        # the future already finished, and a caller may hold the lock around
        # a backlog check and the submit.
        self.lock = threading.RLock()
        self.executor: ThreadPoolExecutor | None = None
        # Each queued or running delivery, with the Lemma trace ID it sends,
        # in submission order.
        self.pending: dict[Future[None], str] = {}

    def submit(self, fn: Callable[[], None], trace_id: str) -> Future[None]:
        with self.lock:
            if self.executor is None:
                self.executor = ThreadPoolExecutor(
                    max_workers=self._workers(),
                    thread_name_prefix=self._thread_name_prefix,
                )
            future = self.executor.submit(fn)
            self.pending[future] = trace_id
            future.add_done_callback(self._forget)
            return future

    def snapshot(self) -> dict[Future[None], str]:
        with self.lock:
            return dict(self.pending)

    def _forget(self, future: Future[None]) -> None:
        with self.lock:
            self.pending.pop(future, None)


_fire_and_forget = _Pool(lambda: OFF_LOOP_WORKERS, "uselemma-delivery")
_awaited = _Pool(lambda: AWAITED_WORKERS, "uselemma-awaited-delivery")


def on_event_loop_thread() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def submit(fn: Callable[[], None], trace_id: str) -> bool:
    """Queue ``fn`` without waiting; False when the backlog is full and it is not queued."""
    with _fire_and_forget.lock:
        if len(_fire_and_forget.pending) >= OFF_LOOP_MAX_BACKLOG:
            return False
        _fire_and_forget.submit(fn, trace_id)
    return True


async def run_awaited(fn: Callable[[], None], trace_id: str) -> None:
    """Run ``fn`` on the awaited pool, in the caller's context, and wait for it."""
    await asyncio.wrap_future(_awaited.submit(partial(copy_context().run, fn), trace_id))


def wait_pending(moment: Literal["flush", "exit"] = "flush") -> None:
    """Wait up to the drain deadline for fire-and-forget deliveries to finish.

    Deliveries that have not started by then are dropped and reported once; a
    delivery already sending finishes or times out on its own.
    """
    _drain([_fire_and_forget], moment)


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

# Each pool's own exit hook joins its workers after running every queued
# delivery. Hooks run newest first, and this one registers after it, so the
# backlog is cut to the deadline before that join.
if hasattr(threading, "_register_atexit"):
    threading._register_atexit(_drain_at_exit)
