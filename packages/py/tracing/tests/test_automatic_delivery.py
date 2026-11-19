from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone

from uselemma_tracing.client import Lemma, TraceContext
from uselemma_tracing.debug_mode import disable_debug_mode, enable_debug_mode
from uselemma_tracing.delivery import INGEST_MAX_ATTEMPTS

PROJECT_ID = "10000000-0000-0000-0000-000000000001"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _lemma_warnings(caplog) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name.startswith("uselemma_tracing")
        and record.levelname == "WARNING"
    ]


def test_automatic_delivery_retries_transient_failures_with_the_same_payload(
    caplog, retry_sleeps
):
    bodies = []
    responses = iter([(503, "busy"), ConnectionResetError("reset"), (201, "{}")])

    def transport(_url, _headers, body):
        bodies.append(body)
        outcome = next(responses)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    assert lemma.trace("support-agent", lambda _trace: "ok") == "ok"
    assert len(bodies) == 3
    assert len(set(bodies)) == 1
    assert len(retry_sleeps) == 2
    assert _lemma_warnings(caplog) == []


def test_automatic_delivery_warns_once_when_every_attempt_fails(caplog):
    calls = []
    trace_ids = []

    def transport(_url, _headers, body):
        calls.append(body)
        return 503, "nope"

    def run(trace):
        trace_ids.append(trace.id)
        return "ok"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    assert lemma.trace("support-agent", run) == "ok"
    assert len(calls) == INGEST_MAX_ATTEMPTS
    assert _lemma_warnings(caplog) == [
        f"uselemma-tracing: dropped trace {trace_ids[0]} after "
        f"{INGEST_MAX_ATTEMPTS} attempts: ingest returned 503. Drops in the next "
        "60s are counted, not logged; set LEMMA_DEBUG=1 to log each one."
    ]


def test_automatic_delivery_fails_open_on_a_misbehaving_transport(caplog):
    # A string status breaks the 2xx comparison; it must not escape trace().
    calls = []

    def transport(_url, _headers, _body):
        calls.append(1)
        return "201", "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    assert lemma.trace("support-agent", lambda _trace: "ok") == "ok"
    assert len(calls) == INGEST_MAX_ATTEMPTS
    [warning] = _lemma_warnings(caplog)
    assert f"after {INGEST_MAX_ATTEMPTS} attempts: TypeError:" in warning


def test_automatic_delivery_does_not_retry_a_rejected_request(caplog, retry_sleeps):
    calls = []

    def transport(_url, _headers, body):
        calls.append(body)
        return 401, "bad key"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    assert lemma.trace("support-agent", lambda _trace: "ok") == "ok"
    assert len(calls) == 1
    assert retry_sleeps == []
    [warning] = _lemma_warnings(caplog)
    assert "after 1 attempt: ingest returned 401 (check LEMMA_API_KEY)" in warning


def test_automatic_delivery_waits_out_a_429_retry_after(caplog, retry_sleeps):
    responses = iter([(429, "slow down", {"Retry-After": "1"}), (201, "{}", {})])
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        transport=lambda _url, _headers, _body: next(responses),
    )

    assert lemma.trace("support-agent", lambda _trace: "ok") == "ok"
    assert retry_sleeps == [1.0]
    assert _lemma_warnings(caplog) == []


def test_automatic_delivery_warns_when_the_payload_cannot_be_built(caplog):
    calls = []

    def before_send(_payload):
        raise ValueError("redaction failed")

    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        transport=lambda *args: calls.append(args) or (201, "{}"),
        before_send=before_send,
    )

    assert lemma.trace("support-agent", lambda _trace: "ok") == "ok"
    assert calls == []
    [warning] = _lemma_warnings(caplog)
    assert " before sending: ValueError: redaction failed. Drops" in warning


def test_a_failed_verify_poll_after_delivery_is_not_a_dropped_trace(
    monkeypatch, caplog, capsys
):
    monkeypatch.setenv("LEMMA_DEBUG_VERIFY", "1")
    monkeypatch.setattr(
        Lemma, "_urllib_get", staticmethod(lambda _url, _headers: (200, "[]", {}))
    )
    enable_debug_mode()
    try:
        lemma = Lemma(
            api_key="key",
            project_id=PROJECT_ID,
            transport=lambda *_args: (201, "{}"),
        )
        assert lemma.trace("support-agent", lambda _trace: "ok") == "ok"
    finally:
        disable_debug_mode()

    assert _lemma_warnings(caplog) == []
    assert "ingest-status check failed" in capsys.readouterr().out


def test_a_failing_post_send_check_stays_out_of_the_caller_and_drop_warnings(
    monkeypatch, caplog
):
    def broken_check(self, _payload, _sent):
        raise RuntimeError("check broke")

    monkeypatch.setattr(Lemma, "_after_trace_sent", broken_check)
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        transport=lambda *_args: (201, "{}"),
    )

    assert lemma.trace("support-agent", lambda _trace: "ok") == "ok"
    lemma.ingest(TraceContext(id="trace-2", name="t"), started_at=_now_utc())

    warnings = _lemma_warnings(caplog)
    assert len(warnings) == 2
    assert all(
        "was delivered, but its post-send check failed: RuntimeError: check broke"
        in warning
        for warning in warnings
    )
    assert warnings[1].startswith("uselemma-tracing: trace trace-2 was delivered")
    assert not any("dropped trace" in w for w in warnings)


def test_before_send_drop_is_not_a_dropped_trace_warning(caplog):
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        transport=lambda *_args: (201, "{}"),
        before_send=lambda _payload: None,
    )

    assert lemma.trace("support-agent", lambda _trace: "ok") == "ok"
    assert _lemma_warnings(caplog) == []


async def test_async_trace_retries_off_the_event_loop_thread(monkeypatch):
    loop_thread = threading.get_ident()
    send_threads = []
    sleep_threads = []
    monkeypatch.setattr(
        "uselemma_tracing.delivery.sleep",
        lambda _seconds: sleep_threads.append(threading.get_ident()),
    )

    def transport(_url, _headers, _body):
        send_threads.append(threading.get_ident())
        return 503, "busy"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    async def run(_trace):
        return "ok"

    assert await lemma.async_trace("support-agent", run) == "ok"
    assert len(send_threads) == INGEST_MAX_ATTEMPTS
    assert len(sleep_threads) == INGEST_MAX_ATTEMPTS - 1
    assert loop_thread not in send_threads + sleep_threads


async def test_concurrent_async_traces_each_await_their_own_delivery():
    # Each call waits on its own worker thread, so neither queues behind the other.
    barrier = threading.Barrier(2, timeout=5)

    def transport(_url, _headers, _body):
        barrier.wait()
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    async def run(_trace):
        return "ok"

    results = await asyncio.gather(
        lemma.async_trace("first", run), lemma.async_trace("second", run)
    )

    assert results == ["ok", "ok"]
    assert not barrier.broken
