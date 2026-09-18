from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from uselemma_tracing.langchain_eviction import (
    DEFAULT_EVICTION_INTERVAL,
    coerce_interval,
    coerce_ttl,
    last_activity_at,
    maybe_evict_stale_traces,
    select_stale_traces,
)


@dataclass
class _Trace:
    opened_at: datetime
    ended: bool = False
    latest_end: datetime | None = None


def _ts(hours: int = 0, minutes: int = 0) -> datetime:
    return datetime(2026, 1, 1, 12, tzinfo=timezone.utc) + timedelta(
        hours=hours, minutes=minutes
    )


def test_coerce_ttl_none_disables_and_numbers_are_seconds():
    assert coerce_ttl(None) is None
    assert coerce_ttl(timedelta(hours=2)) == timedelta(hours=2)
    assert coerce_ttl(90) == timedelta(seconds=90)
    assert coerce_ttl(1.5) == timedelta(seconds=1.5)


def test_coerce_interval_none_uses_default():
    assert coerce_interval(None) == DEFAULT_EVICTION_INTERVAL
    assert coerce_interval(timedelta(minutes=1)) == timedelta(minutes=1)
    assert coerce_interval(30) == timedelta(seconds=30)


def test_last_activity_uses_latest_end_and_run_starts():
    opened = _ts(hours=-3)
    stored = _Trace(opened_at=opened, latest_end=_ts(minutes=-10))
    assert last_activity_at(stored) == _ts(minutes=-10)
    assert last_activity_at(stored, [_ts(minutes=-1)]) == _ts(minutes=-1)
    assert last_activity_at(_Trace(opened_at=opened)) == opened


def test_select_stale_traces_skips_young_ended_and_recently_active():
    now = _ts()
    traces = {
        "stale": _Trace(opened_at=_ts(hours=-3)),
        "young": _Trace(opened_at=_ts(minutes=-10)),
        "ended": _Trace(opened_at=_ts(hours=-3), ended=True),
        "recent_child_end": _Trace(
            opened_at=_ts(hours=-3), latest_end=_ts(minutes=-5)
        ),
        "open_child": _Trace(opened_at=_ts(hours=-3)),
    }
    stale = select_stale_traces(
        traces,
        now=now,
        ttl=timedelta(hours=2),
        run_activity={"open_child": [_ts(minutes=-2)]},
    )
    assert [trace_id for trace_id, _stored in stale] == ["stale"]


def test_maybe_evict_finalizes_stale_only_and_is_interval_gated(caplog):
    import logging

    now = _ts()
    traces = {
        "stale": _Trace(opened_at=_ts(hours=-3)),
        "young": _Trace(opened_at=_ts(minutes=-10)),
        "active": _Trace(opened_at=_ts(hours=-3), latest_end=_ts(minutes=-1)),
    }
    finalized = []

    with caplog.at_level(logging.WARNING, logger="uselemma_tracing.langchain_eviction"):
        last = maybe_evict_stale_traces(
            traces,
            ttl=timedelta(hours=2),
            interval=timedelta(minutes=5),
            last_eviction=None,
            now=now,
            finalize=lambda tid, stored: finalized.append(tid),
        )
    assert last == now
    assert finalized == ["stale"]
    assert "Evicting 1 stale LangChain trace" in caplog.text

    finalized.clear()
    later = maybe_evict_stale_traces(
        traces,
        ttl=timedelta(hours=2),
        interval=timedelta(minutes=5),
        last_eviction=now,
        now=now + timedelta(minutes=1),
        finalize=lambda tid, stored: finalized.append(tid),
    )
    assert later == now
    assert finalized == []


def test_maybe_evict_ttl_none_is_noop():
    traces = {"stale": _Trace(opened_at=_ts(hours=-10))}
    finalized = []
    last = maybe_evict_stale_traces(
        traces,
        ttl=None,
        interval=timedelta(0),
        last_eviction=None,
        now=_ts(),
        finalize=lambda tid, stored: finalized.append(tid),
    )
    assert last is None
    assert finalized == []
