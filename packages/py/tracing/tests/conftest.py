from __future__ import annotations

import pytest

from uselemma_tracing import off_loop
from uselemma_tracing.dropped_traces import reset_dropped_trace_warnings


@pytest.fixture(autouse=True)
def retry_sleeps(monkeypatch):
    """Record automatic-delivery retry backoff instead of waiting it out."""
    sleeps: list[float] = []
    monkeypatch.setattr("uselemma_tracing.delivery.sleep", sleeps.append)
    return sleeps


@pytest.fixture(autouse=True)
def _fresh_dropped_trace_warnings():
    """The dropped-trace warning budget is process-wide; each test starts fresh."""
    reset_dropped_trace_warnings()
    yield
    reset_dropped_trace_warnings()


@pytest.fixture(autouse=True)
def _drain_off_loop_deliveries():
    """No test leaves a handed-off delivery running into the next one."""
    yield
    off_loop.wait_pending()
