from __future__ import annotations

import pytest

from uselemma_tracing.debug_mode import disable_debug_mode, enable_debug_mode
from uselemma_tracing.dropped_traces import (
    DROPPED_TRACE_WARNING_WINDOW_SECONDS,
    report_dropped_trace,
)

WINDOW = DROPPED_TRACE_WARNING_WINDOW_SECONDS
CAUSE = "after 3 attempts: ingest returned 503"
NEXT = (
    "Drops in the next 60s are counted, not logged; set LEMMA_DEBUG=1 to log "
    "each one."
)


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr("uselemma_tracing.dropped_traces.monotonic", fake)
    return fake


def _drop(trace_id: str) -> None:
    report_dropped_trace(trace_id, CAUSE)


def _warnings(caplog) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name.startswith("uselemma_tracing")
        and record.levelname == "WARNING"
    ]


def test_first_drop_warns_once_with_the_trace_id(clock, caplog):
    _drop("trace-1")

    assert _warnings(caplog) == [
        f"uselemma-tracing: dropped trace trace-1 {CAUSE}. {NEXT}"
    ]


def test_drops_inside_the_window_are_counted_without_lines(clock, caplog):
    _drop("trace-1")
    for index in range(2, 51):
        clock.now += 1
        _drop(f"trace-{index}")

    assert len(_warnings(caplog)) == 1


def test_the_first_drop_after_the_window_reports_the_count(clock, caplog):
    _drop("trace-1")
    _drop("trace-2")
    _drop("trace-3")
    clock.now += WINDOW
    _drop("trace-4")

    assert _warnings(caplog)[1:] == [
        f"uselemma-tracing: dropped trace trace-4 {CAUSE}. 2 more dropped since "
        f"the last warning. {NEXT}"
    ]


def test_each_warning_starts_a_new_window_and_count(clock, caplog):
    _drop("trace-1")
    _drop("trace-2")
    clock.now += WINDOW
    _drop("trace-3")
    clock.now += WINDOW - 1
    _drop("trace-4")
    clock.now += 1
    _drop("trace-5")

    assert _warnings(caplog) == [
        f"uselemma-tracing: dropped trace trace-1 {CAUSE}. {NEXT}",
        f"uselemma-tracing: dropped trace trace-3 {CAUSE}. 1 more dropped since "
        f"the last warning. {NEXT}",
        f"uselemma-tracing: dropped trace trace-5 {CAUSE}. 1 more dropped since "
        f"the last warning. {NEXT}",
    ]


def test_debug_mode_logs_every_drop(clock, caplog):
    enable_debug_mode()
    try:
        for index in range(1, 4):
            _drop(f"trace-{index}")
    finally:
        disable_debug_mode()

    assert _warnings(caplog) == [
        f"uselemma-tracing: dropped trace trace-{index} {CAUSE}." for index in range(1, 4)
    ]
