from __future__ import annotations

import pytest

from uselemma_tracing.client import _DroppedTraceWarnings
from uselemma_tracing.debug_delivery import DROPPED_TRACE_WARNING_WINDOW_SECONDS
from uselemma_tracing.debug_mode import disable_debug_mode, enable_debug_mode

WINDOW = DROPPED_TRACE_WARNING_WINDOW_SECONDS


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


class FakeTimer:
    def __init__(self, delay, fn) -> None:
        self.delay = delay
        self.fn = fn
        self.cancelled = False

    def cancel(self) -> None:
        self.cancelled = True


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def timers():
    return []


@pytest.fixture
def exits():
    return []


@pytest.fixture
def throttle(clock, timers, exits):
    def schedule(delay, fn):
        timer = FakeTimer(delay, fn)
        timers.append(timer)
        return timer

    return _DroppedTraceWarnings(
        clock=clock, schedule=schedule, register_exit=exits.append
    )


def _drop(throttle, trace_id, reason="ingest returned 503"):
    throttle.report(trace_id, 3, reason)


def _warnings(caplog) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == "uselemma_tracing.client"
        and record.levelname == "WARNING"
    ]


def test_first_drop_warns_once_with_the_trace_id(throttle, caplog):
    _drop(throttle, "trace-1")

    assert _warnings(caplog) == [
        "uselemma-tracing: dropped trace trace-1 after 3 attempts: ingest returned "
        "503. Further drops are counted and reported every 60s; set LEMMA_DEBUG=1 "
        "to log each one."
    ]


def test_a_burst_inside_the_window_writes_no_extra_lines(throttle, timers, caplog):
    _drop(throttle, "trace-1")
    for index in range(2, 51):
        _drop(throttle, f"trace-{index}")

    assert len(_warnings(caplog)) == 1
    assert [timer.delay for timer in timers] == [WINDOW]


def test_the_window_end_reports_its_count(throttle, clock, timers, caplog):
    _drop(throttle, "trace-1")
    _drop(throttle, "trace-2")
    _drop(throttle, "trace-3", "TimeoutError: timed out")

    clock.now += WINDOW
    timers[0].fn()

    assert _warnings(caplog)[1:] == [
        "uselemma-tracing: dropped 2 more traces in the last 60s; latest: "
        "TimeoutError: timed out. Set LEMMA_DEBUG=1 to log each one."
    ]


def test_drops_pending_past_an_expired_window_are_reported_on_the_next_drop(
    throttle, clock, caplog
):
    _drop(throttle, "trace-1")
    _drop(throttle, "trace-2")
    clock.now += WINDOW
    _drop(throttle, "trace-3")

    warnings = _warnings(caplog)
    assert len(warnings) == 2
    assert "dropped 2 more traces in the last 60s" in warnings[1]


def test_a_drop_after_a_quiet_window_warns_with_its_trace_id(throttle, clock, caplog):
    _drop(throttle, "trace-1")
    clock.now += WINDOW
    _drop(throttle, "trace-2")

    warnings = _warnings(caplog)
    assert len(warnings) == 2
    assert "dropped trace trace-2 after" in warnings[1]


def test_debug_mode_logs_every_drop(throttle, caplog):
    enable_debug_mode()
    try:
        for index in range(1, 4):
            _drop(throttle, f"trace-{index}")
    finally:
        disable_debug_mode()

    assert _warnings(caplog) == [
        f"uselemma-tracing: dropped trace trace-{index} after 3 attempts: "
        "ingest returned 503."
        for index in range(1, 4)
    ]


def test_exit_flush_prints_the_pending_count_once(throttle, clock, timers, exits, caplog):
    _drop(throttle, "trace-1")
    _drop(throttle, "trace-2")
    _drop(throttle, "trace-3")
    clock.now += 20

    assert len(exits) == 1
    exits[0]()
    throttle.flush()

    assert _warnings(caplog)[1:] == [
        "uselemma-tracing: dropped 2 more traces in the last 20s; latest: ingest "
        "returned 503. Set LEMMA_DEBUG=1 to log each one."
    ]
    assert timers[0].cancelled
