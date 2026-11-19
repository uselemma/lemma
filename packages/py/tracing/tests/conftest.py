from __future__ import annotations

import pytest

from uselemma_tracing.client import _DroppedTraceWarnings


@pytest.fixture(autouse=True)
def retry_sleeps(monkeypatch):
    """Record automatic-delivery retry backoff instead of waiting it out."""
    sleeps: list[float] = []
    monkeypatch.setattr("uselemma_tracing.client._retry_sleep", sleeps.append)
    return sleeps


@pytest.fixture(autouse=True)
def dropped_traces(monkeypatch):
    """A fresh process-wide warning throttle, without a timer thread or exit hook."""
    throttle = _DroppedTraceWarnings(
        schedule=lambda _delay, _fn: None,
        register_exit=lambda _fn: None,
    )
    monkeypatch.setattr("uselemma_tracing.client._dropped_traces", throttle)
    return throttle
