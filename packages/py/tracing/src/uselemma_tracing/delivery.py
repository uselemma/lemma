from __future__ import annotations

import math
import random as _random
from dataclasses import dataclass
from time import sleep
from typing import Any, Callable, Mapping, Union

from .debug_delivery import pick_response_headers
from .debug_mode import _lemma_debug
from .error_message import describe_error, failure_message

# Sends per ingest() call. Queue and plugin producers keep their own retry
# backlog, so ingest() sends once and raises.
INGEST_STRICT_ATTEMPTS = 1
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

# One POST of a serialized payload; the client owns the URL and credentials.
# Response header keys are lowercase.
PostIngest = Callable[[], tuple[int, str, dict[str, str]]]


@dataclass(frozen=True)
class Delivered:
    status: int
    headers: dict[str, str]


@dataclass(frozen=True)
class DeliveryFailure:
    error: Exception
    # Completes "dropped trace <id> ...".
    cause: str


DeliveryResult = Union[Delivered, DeliveryFailure]


@dataclass(frozen=True)
class _SendFailed:
    error: Exception
    reason: str
    retryable: bool
    retry_after_seconds: float | None


_SendAttempt = Union[Delivered, _SendFailed]


def failed_before_sending(error: Exception) -> DeliveryFailure:
    """A payload that could not be built or shaped; nothing was sent."""
    return DeliveryFailure(error=error, cause=f"before sending: {describe_error(error)}")


def _failed_after(attempts: int, attempt: _SendFailed) -> DeliveryFailure:
    return DeliveryFailure(
        error=attempt.error,
        cause=f"after {attempts} attempt{'' if attempts == 1 else 's'}: {attempt.reason}",
    )


def ingest_failure_hint(status: int) -> str | None:
    hints = {
        401: "check LEMMA_API_KEY",
        403: "API key doesn't own this project_id",
        429: "ingest rate limit exceeded; lower the trace rate if it persists",
        404: "baseUrl likely wrong (not Lemma API)",
    }
    return hints.get(status)


def is_retryable_ingest_status(status: int) -> bool:
    """Statuses where resending the same payload can succeed.

    A resend after a success the client never saw is harmless: ingest skips
    stored span IDs.
    """
    return status == 408 or status == 429 or status >= 500


def parse_retry_after_seconds(value: str | None) -> float | None:
    """Only the delta-seconds form; an HTTP-date falls back to backoff."""
    if value is None or not value.strip():
        return None
    try:
        seconds = float(value)
    except ValueError:
        return None
    return seconds if math.isfinite(seconds) and seconds >= 0 else None


def ingest_retry_delay_seconds(
    retry: int,
    retry_after_seconds: float | None,
    random: Callable[[], float] = _random.random,
) -> float:
    """Delay before retry number ``retry`` (1-based)."""
    backoff = INGEST_RETRY_BASE_DELAY_SECONDS * 2 ** (retry - 1)
    jittered = backoff / 2 + random() * (backoff / 2)
    return min(INGEST_RETRY_MAX_DELAY_SECONDS, max(jittered, retry_after_seconds or 0.0))


def _send_once(post: PostIngest, log_fields: Mapping[str, Any]) -> _SendAttempt:
    """Send once and classify the outcome.

    Classification sits inside the ``try``, so whatever a custom transport
    returns or raises becomes a failed attempt instead of an exception.
    """
    try:
        status, text, headers = post()
        if 200 <= status < 300:
            return Delivered(status=status, headers=headers)
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
        return _SendFailed(
            error=RuntimeError(
                f"uselemma-tracing: failed to ingest trace ({status}): {text}"
            ),
            reason=f"ingest returned {status}" + (f" ({hint})" if hint else ""),
            retryable=is_retryable_ingest_status(status),
            retry_after_seconds=parse_retry_after_seconds(headers.get("retry-after")),
        )
    except Exception as exc:
        _lemma_debug(
            "client", "trace ingest failed", **log_fields, error=failure_message(exc)
        )
        return _SendFailed(
            error=exc,
            reason=describe_error(exc),
            retryable=True,
            retry_after_seconds=None,
        )


def deliver(
    post: PostIngest, log_fields: Mapping[str, Any], *, max_attempts: int
) -> DeliveryResult:
    """Send up to ``max_attempts`` times, backing off between retryable failures."""
    attempts = 0
    while True:
        attempts += 1
        attempt = _send_once(post, log_fields)
        if isinstance(attempt, Delivered):
            return attempt
        if not attempt.retryable or attempts >= max_attempts:
            return _failed_after(attempts, attempt)
        delay = ingest_retry_delay_seconds(attempts, attempt.retry_after_seconds)
        _lemma_debug(
            "client",
            "retrying trace ingest",
            **log_fields,
            attempt=attempts,
            max_attempts=max_attempts,
            delay_seconds=delay,
        )
        sleep(delay)
