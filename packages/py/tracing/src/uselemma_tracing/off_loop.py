"""SDK-owned worker pools that keep automatic delivery off the event loop.

Automatic delivery blocks on the transport and on retry backoff. Delivery its
caller does not wait for goes to the fire-and-forget pool: from a sync hook that
an async framework calls on its loop thread, and from an ``async_trace``
cancelled while its callback runs. Otherwise ``async_trace`` awaits delivery on
the awaited pool. An async flush waits for the fire-and-forget pool on the
event loop.
"""

from __future__ import annotations

import asyncio
import atexit
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor, wait
from contextvars import Context, copy_context
from typing import Callable, Literal

from .delivery import (
    INGEST_MAX_ATTEMPTS,
    INGEST_REQUEST_TIMEOUT_SECONDS,
    INGEST_RETRY_MAX_DELAY_SECONDS,
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

# Causes for the drops reported here; each completes "dropped trace <id> ...".
_BACKLOG_FULL = "before sending: delivery backlog full"


def _still_queued(count: int, moment: Literal["flush", "exit"]) -> str:
    noun = "delivery" if count == 1 else "deliveries"
    return f"before sending: {count} {noun} still queued at {moment}"


class _Pool:
    """A lazily started executor that tracks each queued or running delivery."""

    def __init__(self, workers: int, thread_name_prefix: str) -> None:
        self._workers = workers
        self._thread_name_prefix = thread_name_prefix
        self.reset()

    def reset(self) -> None:
        # Reentrant: claim_unstarted holds it while cancel() runs _forget on
        # the same thread.
        self.lock = threading.RLock()
        self.executor: ThreadPoolExecutor | None = None
        # Each queued or running delivery, with the Lemma trace ID it sends,
        # in submission order.
        self.pending: dict[Future[None], str] = {}

    def submit(self, fn: Callable[[], None], trace_id: str) -> Future[None]:
        """Queue ``fn`` to run in the submitting thread's context."""
        # Copied here, on the caller's thread, so before_send and a custom
        # transport see the caller's ContextVars on the worker.
        context = copy_context()
        with self.lock:
            if self.executor is None:
                self.executor = ThreadPoolExecutor(
                    max_workers=self._workers,
                    thread_name_prefix=self._thread_name_prefix,
                )
            try:
                future: Future[None] | None = self.executor.submit(context.run, fn)
            except RuntimeError:
                future = None
            else:
                self.pending[future] = trace_id
        if future is None:
            # Executors refuse new work once interpreter shutdown starts. A
            # thread that outlives the main thread still delivers, inline.
            return _run_inline(context, fn)
        future.add_done_callback(self._forget)
        return future

    def snapshot(self) -> dict[Future[None], str]:
        with self.lock:
            return dict(self.pending)

    def claim_unstarted(self, snapshot: dict[Future[None], str]) -> list[str]:
        """Cancel each of this pool's deliveries in ``snapshot`` that has not
        started, and return their trace IDs in submission order.

        Only a future still pending is claimed, under the lock, so drains that
        overlap claim each delivery once: ``cancel()`` also returns True for a
        future another drain already cancelled.
        """
        with self.lock:
            return [
                trace_id
                for future, trace_id in snapshot.items()
                if future in self.pending and future.cancel()
            ]

    def _forget(self, future: Future[None]) -> None:
        with self.lock:
            self.pending.pop(future, None)


def _run_inline(context: Context, fn: Callable[[], None]) -> Future[None]:
    future: Future[None] = Future()
    try:
        context.run(fn)
    except Exception as exc:
        future.set_exception(exc)
    else:
        future.set_result(None)
    return future


_fire_and_forget = _Pool(OFF_LOOP_WORKERS, "uselemma-delivery")
_awaited = _Pool(AWAITED_WORKERS, "uselemma-awaited-delivery")


def hand_off(fn: Callable[[], None], trace_id: str) -> None:
    """Deliver without blocking a running event loop: from a sync hook that an
    async framework may call on its loop thread, or from an ``async_trace``
    cancelled while its callback runs.

    Inline when the thread runs no event loop; otherwise queued on the
    fire-and-forget pool without waiting, or reported as dropped when that
    pool's backlog is full.
    """
    if not _on_event_loop_thread():
        fn()
        return
    pool = _fire_and_forget
    with pool.lock:
        full = len(pool.pending) >= OFF_LOOP_MAX_BACKLOG
    if full:
        report_dropped_trace(trace_id, _BACKLOG_FULL)
        return
    # Outside the lock, because during interpreter shutdown submit delivers
    # inline and must not hold up other threads' hand-offs. Concurrent
    # hand-offs can each pass the check before any submits, overshooting the
    # cap by at most their number; the cap only bounds memory, so that is
    # harmless.
    pool.submit(fn, trace_id)


def _on_event_loop_thread() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


async def run_awaited(fn: Callable[[], None], trace_id: str) -> None:
    """Run ``fn`` on the awaited pool and wait for it.

    Cancelling the caller, by its own timeout or by ``asyncio.run`` shutting
    down, ends only the wait: nothing links the waiter back to the delivery,
    which still runs or is reported by the exit drain.
    """
    future = _awaited.submit(fn, trace_id)
    await _waiter_on(asyncio.get_running_loop(), future)


def _waiter_on(
    loop: asyncio.AbstractEventLoop, future: Future[None]
) -> asyncio.Future[None]:
    """A future on ``loop`` that settles when ``future`` does. Unlike
    ``asyncio.wrap_future``'s, cancelling it leaves the delivery untouched."""
    waiter: asyncio.Future[None] = loop.create_future()

    def wake(done: Future[None]) -> None:
        try:
            loop.call_soon_threadsafe(_settle, waiter, done)
        except RuntimeError:
            # The loop closed while the delivery ran, so nobody is waiting.
            pass

    future.add_done_callback(wake)
    return waiter


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


async def await_pending() -> None:
    """``wait_pending`` for async code: the wait runs on the event loop, so the
    loop keeps running while queued deliveries finish."""
    pending = _fire_and_forget.snapshot()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + OFF_LOOP_DRAIN_DEADLINE_SECONDS
    # Waits on one delivery at a time, so a flush leaves at most one waiter
    # behind: a delivery's future can't drop a done callback, and every waiter
    # left on a queued delivery would run when the backlog is cut.
    for future in pending:
        remaining = deadline - loop.time()
        if remaining <= 0:
            break
        if not future.done():
            await asyncio.wait([_waiter_on(loop, future)], timeout=remaining)
    _cut_unstarted([_fire_and_forget], pending, "flush")


def _drain(pools: list[_Pool], moment: Literal["flush", "exit"]) -> None:
    pending: dict[Future[None], str] = {}
    for pool in pools:
        pending.update(pool.snapshot())
    wait(pending, timeout=OFF_LOOP_DRAIN_DEADLINE_SECONDS)
    _cut_unstarted(pools, pending, moment)


def _cut_unstarted(
    pools: list[_Pool],
    pending: dict[Future[None], str],
    moment: Literal["flush", "exit"],
) -> None:
    """Drop each delivery in ``pending`` that has not started and report them once."""
    # Submission order, so the report names the oldest dropped delivery.
    dropped = [
        trace_id for pool in pools for trace_id in pool.claim_unstarted(pending)
    ]
    if dropped:
        report_dropped_trace(
            dropped[0], _still_queued(len(dropped), moment), count=len(dropped)
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


def _register_exit_drain() -> None:
    # concurrent.futures registers one module-level exit hook,
    # concurrent.futures.thread._python_exit, with the private
    # threading._register_atexit; it joins every executor's workers after they
    # run all queued work. Those hooks run newest first, before the interpreter
    # joins non-daemon threads, and this one registers after it, so both pools'
    # backlogs are cut to the deadline before that join. The public atexit
    # fallback is a defensive path for an interpreter whose concurrent.futures
    # does not use the private hook.
    register_before_thread_join = getattr(threading, "_register_atexit", None)
    if register_before_thread_join is None:
        atexit.register(_drain_at_exit)
    else:
        register_before_thread_join(_drain_at_exit)


_register_exit_drain()
