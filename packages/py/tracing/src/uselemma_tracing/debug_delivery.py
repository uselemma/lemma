from __future__ import annotations

import math
import random as _random
import re
from typing import Callable

PRODUCTION_BASE_URL = "https://api.uselemma.ai"
INGEST_PATH = "/traces/ingest"
INGEST_STATUS_PATH = "/traces/ingest-status"
EXPECTED_INGEST_SUCCESS_STATUS = 201

# Poll interval / budget for LEMMA_DEBUG_VERIFY ingest-status checks.
INGEST_STATUS_POLL_INTERVAL_SECONDS = 1.0
INGEST_STATUS_POLL_TIMEOUT_SECONDS = 15.0

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

IngestStatus = str  # "enqueued" | "ingested" | "ready" | "not_found"
_SUCCESS_INGEST_STATUSES = frozenset({"enqueued", "ingested", "ready"})


def is_successful_ingest_status(status: str | None) -> bool:
    return status in _SUCCESS_INGEST_STATUSES


def parse_ingest_status(value: object) -> str | None:
    if value in {"enqueued", "ingested", "ready", "not_found"}:
        return str(value)
    return None

_UUID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def is_valid_project_id(project_id: str) -> bool:
    return bool(_UUID_REGEX.fullmatch(project_id))


def api_key_suffix(api_key: str) -> str:
    if len(api_key) <= 4:
        return api_key
    return f"...{api_key[-4:]}"


def build_config_warnings(base_url: str, project_id: str) -> list[str]:
    warnings: list[str] = []
    if base_url != PRODUCTION_BASE_URL:
        warnings.append(f"baseUrl is not production ({PRODUCTION_BASE_URL})")
    if not is_valid_project_id(project_id):
        warnings.append("projectId is not a valid UUID")
    return warnings


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


def pick_response_headers(headers: dict[str, str]) -> dict[str, str]:
    picked: dict[str, str] = {}
    lowered = {key.lower(): value for key, value in headers.items()}
    for name in ("cf-ray", "server", "date"):
        value = lowered.get(name)
        if value:
            picked[name] = value
    return picked
