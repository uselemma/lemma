from __future__ import annotations

import asyncio
import math
import os
import random as _random
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from time import sleep
from typing import Any, Callable, Dict, Mapping, Optional, Tuple, Union

from .debug_delivery import ingest_failure_hint, pick_response_headers
from .debug_mode import _lemma_debug
from .error_message import describe_error, failure_message

# Sends per automatic delivery: one plus two retries. That rides out a dropped
# connection or an ingest worker restart without holding the caller for long
# while Lemma is down.
INGEST_MAX_ATTEMPTS = 3
# Per-send socket timeout for the default transport, the OTLP exporter default.
# Ingest answers once the payload is stored and enqueued, so a healthy send
# finishes well inside it; without one, a stalled connection blocks the caller
# indefinitely.
INGEST_REQUEST_TIMEOUT_SECONDS = 10.0
# Delay before the first retry; each later retry doubles it. Jitter keeps
# clients that failed together from retrying in lockstep.
INGEST_RETRY_BASE_DELAY_SECONDS = 0.5
# Ceiling for one retry delay, a server Retry-After included, so a rate-limited
# send cannot hold the caller for long.
INGEST_RETRY_MAX_DELAY_SECONDS = 2.0

# Worker threads for automatic delivery handed off an event loop. A few keep
# deliveries from queueing behind one stalled send while staying negligible in
# the host process. The workers are joined at interpreter exit, so queued
# deliveries still go out.
OFF_LOOP_DELIVERY_WORKERS = 4

# One POST of a serialized payload; the client owns the URL and credentials.
PostIngest = Callable[[], Tuple[int, str, Dict[str, str]]]


@dataclass(frozen=True)
class Sent:
    status: int
    headers: Dict[str, str]


@dataclass(frozen=True)
class SendFailed:
    error: Exception
    # Completes "dropped trace <id> after N attempts: ...".
    reason: str
    retryable: bool
    retry_after: Optional[str]


SendAttempt = Union[Sent, SendFailed]


def is_retryable_ingest_status(status: int) -> bool:
    """Statuses where resending the same payload can succeed.

    A resend after a success the client never saw is harmless: ingest skips
    stored span IDs.
    """
    return status == 408 or status == 429 or status >= 500


def ingest_retry_delay_seconds(
    retry: int,
    retry_after: str | None,
    random: Callable[[], float] = _random.random,
) -> float:
    """Delay before retry number ``retry`` (1-based)."""
    backoff = INGEST_RETRY_BASE_DELAY_SECONDS * 2 ** (retry - 1)
    jittered = backoff / 2 + random() * (backoff / 2)
    server_delay = _retry_after_seconds(retry_after)
    return min(INGEST_RETRY_MAX_DELAY_SECONDS, max(jittered, server_delay or 0.0))


def _retry_after_seconds(value: str | None) -> float | None:
    """Only the delta-seconds form; an HTTP-date falls back to backoff."""
    if value is None or not value.strip():
        return None
    try:
        seconds = float(value)
    except ValueError:
        return None
    return seconds if math.isfinite(seconds) and seconds >= 0 else None


def send_once(post: PostIngest, log_fields: Mapping[str, Any]) -> SendAttempt:
    """Send once and classify the outcome."""
    try:
        status, text, headers = post()
    except Exception as exc:
        _lemma_debug(
            "client", "trace ingest failed", **log_fields, error=failure_message(exc)
        )
        return SendFailed(
            error=exc, reason=describe_error(exc), retryable=True, retry_after=None
        )
    if 200 <= status < 300:
        return Sent(status=status, headers=headers)
    hint = ingest_failure_hint(status)
    _lemma_debug(
        "client",
        "trace ingest failed",
        **log_fields,
        status=status,
        body=text,
        **pick_response_headers(headers),
        **({"hint": hint} if hint else {}),
    )
    return SendFailed(
        error=RuntimeError(f"uselemma-tracing: failed to ingest trace ({status}): {text}"),
        reason=f"ingest returned {status}" + (f" ({hint})" if hint else ""),
        retryable=is_retryable_ingest_status(status),
        retry_after=pick_response_headers(headers, ("retry-after",)).get("retry-after"),
    )


def send_with_retries(
    post: PostIngest, log_fields: Mapping[str, Any], *, max_attempts: int
) -> tuple[SendAttempt, int]:
    """Send up to ``max_attempts`` times, backing off between retryable failures.

    Returns the last attempt and how many were made.
    """
    attempts = 0
    while True:
        attempts += 1
        attempt = send_once(post, log_fields)
        if isinstance(attempt, Sent) or not attempt.retryable or attempts >= max_attempts:
            return attempt, attempts
        delay = ingest_retry_delay_seconds(attempts, attempt.retry_after)
        _lemma_debug(
            "client",
            "retrying trace ingest",
            **log_fields,
            attempt=attempts,
            max_attempts=max_attempts,
            delay_seconds=delay,
        )
        sleep(delay)


_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()


def run_off_event_loop(fn: Callable[[], None]) -> Future[None] | None:
    """Run ``fn`` now, or on a worker thread when this thread runs an event loop.

    Automatic delivery blocks on the transport and on retry backoff, so a sync
    hook that an async framework calls on its loop thread must not run it
    there. Returns the worker's future, or None when ``fn`` already ran.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        fn()
        return None
    return _delivery_executor().submit(fn)


def _delivery_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=OFF_LOOP_DELIVERY_WORKERS,
                thread_name_prefix="uselemma-delivery",
            )
        return _executor


def _forget_executor_in_child() -> None:
    # A forked child has none of the parent's workers; submitting to the
    # inherited pool would queue work that never runs.
    global _executor, _executor_lock
    _executor = None
    _executor_lock = threading.Lock()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_forget_executor_in_child)
