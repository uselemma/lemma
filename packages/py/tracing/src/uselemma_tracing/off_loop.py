"""Fire-and-forget delivery for sync hooks that an event loop's thread calls.

Automatic delivery blocks on the transport and on retry backoff, so a hook an
async framework calls on its loop thread hands delivery to this pool instead.
"""

from __future__ import annotations

import asyncio
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor, wait
from typing import Callable

from .delivery import (
    INGEST_MAX_ATTEMPTS,
    INGEST_REQUEST_TIMEOUT_SECONDS,
    INGEST_RETRY_MAX_DELAY_SECONDS,
    still_queued,
)
from .dropped_traces import report_dropped_trace

# Worker threads. A few keep deliveries from queueing behind one stalled send
# while staying negligible in the host process.
OFF_LOOP_WORKERS = 4
# Deliveries queued or running at once. Each holds its payload for up to the
# full retry budget, so during a Lemma outage this bounds the host's memory;
# it is far above a normal burst of finished traces.
OFF_LOOP_MAX_BACKLOG = 1_000
# One delivery's worst case: every attempt times out and every retry waits the
# longest backoff. Flush and exit wait at most this long, for parity with
# TypeScript, whose concurrent deliveries all finish within one retry budget.
OFF_LOOP_DRAIN_DEADLINE_SECONDS = (
    INGEST_MAX_ATTEMPTS * INGEST_REQUEST_TIMEOUT_SECONDS
    + (INGEST_MAX_ATTEMPTS - 1) * INGEST_RETRY_MAX_DELAY_SECONDS
)

_lock = threading.Lock()
_executor: ThreadPoolExecutor | None = None
# Each queued or running delivery, with the Lemma trace ID it sends.
_pending: dict[Future[None], str] = {}


def on_event_loop_thread() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def submit(fn: Callable[[], None], trace_id: str) -> bool:
    """Queue ``fn`` on the pool; False when the backlog is full and it is not queued."""
    global _executor
    with _lock:
        if len(_pending) >= OFF_LOOP_MAX_BACKLOG:
            return False
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=OFF_LOOP_WORKERS,
                thread_name_prefix="uselemma-delivery",
            )
        future = _executor.submit(fn)
        _pending[future] = trace_id
    future.add_done_callback(_forget)
    return True


def wait_pending(moment: str = "flush") -> None:
    """Wait up to the drain deadline for queued deliveries to finish.

    Deliveries that have not started by then are dropped and reported once; a
    delivery already sending finishes or times out on its own.
    """
    with _lock:
        pending = dict(_pending)
    _done, not_done = wait(pending, timeout=OFF_LOOP_DRAIN_DEADLINE_SECONDS)
    # Submission order, so the report names the oldest dropped delivery.
    dropped = [
        trace_id
        for future, trace_id in pending.items()
        if future in not_done and future.cancel()
    ]
    if dropped:
        report_dropped_trace(
            dropped[0], still_queued(len(dropped), moment).cause, count=len(dropped)
        )


def _forget(future: Future[None]) -> None:
    with _lock:
        _pending.pop(future, None)


def _drain_at_exit() -> None:
    wait_pending("exit")


def _reset() -> None:
    # A forked child has none of the parent's workers; submitting to the
    # inherited pool would queue work that never runs.
    global _lock, _executor, _pending
    _lock = threading.Lock()
    _executor = None
    _pending = {}


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_reset)

# The pool's own exit hook joins its workers after running every queued
# delivery. Hooks run newest first, and this one registers after it, so the
# backlog is cut to the deadline before that join.
if hasattr(threading, "_register_atexit"):
    threading._register_atexit(_drain_at_exit)
