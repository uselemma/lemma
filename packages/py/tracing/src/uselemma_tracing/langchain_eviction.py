"""TTL eviction for LangChain handler traces that never receive an end event.

Stale owned traces are finalized (sent) rather than silently dropped: a
partial flush is the same cheap path ``flush()`` uses, and a cancelled run
is not marked as an error. ``ttl is None`` disables eviction. Sweeps are
interval-gated so high-frequency ``on_*_start`` callbacks stay cheap.

Staleness is idle time, not wall time since the root opened. Last activity
is ``max(opened_at, latest_end, run.started_at...)`` so a long agent loop
that still emits child callbacks is not finalized mid-run.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Callable, Iterable, Mapping, Protocol, TypeVar

logger = logging.getLogger(__name__)

DEFAULT_OPEN_TRACE_TTL = timedelta(hours=2)
DEFAULT_EVICTION_INTERVAL = timedelta(minutes=5)


class OpenedTrace(Protocol):
    opened_at: datetime
    ended: bool


TTrace = TypeVar("TTrace", bound=OpenedTrace)


def coerce_ttl(value: float | int | timedelta | None) -> timedelta | None:
    """``None`` disables eviction; numbers are seconds."""
    if value is None:
        return None
    if isinstance(value, timedelta):
        return value
    return timedelta(seconds=float(value))


def coerce_interval(
    value: float | int | timedelta | None,
    *,
    default: timedelta = DEFAULT_EVICTION_INTERVAL,
) -> timedelta:
    if value is None:
        return default
    if isinstance(value, timedelta):
        return value
    return timedelta(seconds=float(value))


def last_activity_at(
    stored: OpenedTrace,
    run_started_at: Iterable[datetime] = (),
) -> datetime:
    times = [stored.opened_at]
    latest_end = getattr(stored, "latest_end", None)
    if isinstance(latest_end, datetime):
        times.append(latest_end)
    times.extend(run_started_at)
    return max(times)


def select_stale_traces(
    traces: dict[str, TTrace],
    *,
    now: datetime,
    ttl: timedelta,
    run_activity: Mapping[str, Iterable[datetime]] | None = None,
) -> list[tuple[str, TTrace]]:
    cutoff = now - ttl
    activity = run_activity or {}
    return [
        (trace_id, stored)
        for trace_id, stored in traces.items()
        if not stored.ended
        and last_activity_at(stored, activity.get(trace_id, ())) < cutoff
    ]


def maybe_evict_stale_traces(
    traces: dict[str, TTrace],
    *,
    ttl: timedelta | None,
    interval: timedelta,
    last_eviction: datetime | None,
    now: datetime,
    finalize: Callable[[str, TTrace], None],
    run_activity: Mapping[str, Iterable[datetime]] | None = None,
) -> datetime | None:
    """Sweep idle open traces. Returns the updated last-eviction timestamp."""
    if ttl is None:
        return last_eviction
    if last_eviction is not None and now - last_eviction < interval:
        return last_eviction

    stale = select_stale_traces(
        traces, now=now, ttl=ttl, run_activity=run_activity
    )
    if stale:
        stale_ids = [trace_id for trace_id, _stored in stale]
        logger.warning(
            "Evicting %s stale LangChain trace(s) that never received an end "
            "event (open_trace_ttl=%s): %s",
            len(stale_ids),
            ttl,
            ", ".join(stale_ids),
        )
        for trace_id, stored in stale:
            finalize(trace_id, stored)
    return now
