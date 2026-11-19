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

# Worker threads. A few keep deliveries from queueing behind one stalled send
# while staying negligible in the host process. They are joined at interpreter
# exit, so queued deliveries still go out.
OFF_LOOP_WORKERS = 4
# Deliveries queued or running at once. Each holds its payload for up to the
# full retry budget, so during a Lemma outage this bounds the host's memory;
# it is far above a normal burst of finished traces.
OFF_LOOP_MAX_BACKLOG = 1_000

_lock = threading.Lock()
_executor: ThreadPoolExecutor | None = None
_pending: set[Future[None]] = set()


def on_event_loop_thread() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def submit(fn: Callable[[], None]) -> bool:
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
        _pending.add(future)
    future.add_done_callback(_forget)
    return True


def wait_pending() -> None:
    """Block until every delivery queued so far has finished."""
    with _lock:
        pending = list(_pending)
    wait(pending)


def _forget(future: Future[None]) -> None:
    with _lock:
        _pending.discard(future)


def _reset_in_child() -> None:
    # A forked child has none of the parent's workers; submitting to the
    # inherited pool would queue work that never runs.
    global _lock, _executor, _pending
    _lock = threading.Lock()
    _executor = None
    _pending = set()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_reset_in_child)
