from __future__ import annotations

import asyncio
import contextvars
import json
import subprocess
import sys
import textwrap
import threading
from concurrent.futures import ThreadPoolExecutor, wait

import pytest
from datetime import datetime, timezone

from uselemma_tracing import off_loop
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


async def test_a_stalled_awaited_delivery_does_not_hold_a_default_executor_thread():
    loop = asyncio.get_running_loop()
    loop.set_default_executor(ThreadPoolExecutor(max_workers=1))
    sending = threading.Event()
    release = threading.Event()

    def transport(_url, _headers, _body):
        sending.set()
        release.wait(timeout=5)
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    async def run(_trace):
        return "ok"

    trace = asyncio.create_task(lemma.async_trace("support-agent", run))
    for _ in range(200):
        if sending.is_set():
            break
        await asyncio.sleep(0.01)
    assert sending.is_set()

    # The host's only default-executor thread is still free for its own work.
    free = await asyncio.wait_for(loop.run_in_executor(None, lambda: "free"), 2)
    release.set()

    assert free == "free"
    assert await trace == "ok"


async def test_cancelling_a_queued_async_trace_still_delivers_it(monkeypatch):
    monkeypatch.setattr(
        off_loop, "_awaited", off_loop._Pool(1, "uselemma-awaited-delivery")
    )
    release = threading.Event()
    sent = []

    def transport(_url, _headers, body):
        name = json.loads(body)["trace"]["name"]
        if name == "first":
            release.wait(timeout=5)
        sent.append(name)
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    async def run(_trace):
        return "ok"

    first = asyncio.create_task(lemma.async_trace("first", run))
    second = asyncio.create_task(lemma.async_trace("second", run))
    for _ in range(200):
        if len(off_loop._awaited.snapshot()) == 2:
            break
        await asyncio.sleep(0.01)
    # The second delivery is queued behind the first when its caller cancels.
    second.cancel()
    with pytest.raises(asyncio.CancelledError):
        await second
    release.set()

    assert await first == "ok"
    wait(list(off_loop._awaited.snapshot()), timeout=5)
    assert sent == ["first", "second"]


async def test_cancelling_an_async_trace_mid_run_does_not_wait_for_its_delivery():
    sending = threading.Event()
    release = threading.Event()
    sent = []

    def transport(_url, _headers, body):
        sending.set()
        release.wait(timeout=5)
        sent.append(json.loads(body)["trace"])
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    running = asyncio.Event()

    async def run(_trace):
        running.set()
        await asyncio.sleep(30)

    trace = asyncio.create_task(lemma.async_trace("support-agent", run))
    await running.wait()
    trace.cancel()

    # The cancellation reaches the caller while the delivery is still stalled;
    # awaiting delivery would make wait_for time out instead.
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(trace, timeout=2)
    assert sending.wait(timeout=2)
    assert sent == []

    release.set()
    wait(list(off_loop._fire_and_forget.snapshot()), timeout=5)
    assert len(sent) == 1
    assert sent[0]["status"] == "ERROR"
    assert "CancelledError" in sent[0]["error"]


async def test_a_cancelled_async_trace_is_reported_dropped_when_the_backlog_is_full(
    monkeypatch, caplog
):
    monkeypatch.setattr(off_loop, "OFF_LOOP_MAX_BACKLOG", 0)
    sent = []

    def transport(_url, _headers, body):
        sent.append(body)
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    running = asyncio.Event()

    async def run(_trace):
        running.set()
        await asyncio.sleep(30)

    trace = asyncio.create_task(lemma.async_trace("support-agent", run))
    await running.wait()
    trace.cancel()
    with pytest.raises(asyncio.CancelledError):
        await trace

    assert sent == []
    assert any("backlog full" in warning for warning in _lemma_warnings(caplog))


async def test_an_async_trace_that_raises_still_awaits_its_delivery():
    sent = []

    def transport(_url, _headers, body):
        sent.append(json.loads(body)["trace"])
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    async def run(_trace):
        raise ValueError("tool failed")

    with pytest.raises(ValueError, match="tool failed"):
        await lemma.async_trace("support-agent", run)

    # Delivered before the error reached the caller, with no pool to drain.
    assert len(sent) == 1
    assert sent[0]["error"] == "ValueError: tool failed"


def test_asyncio_run_exiting_with_queued_awaited_deliveries_reports_them():
    script = textwrap.dedent(
        """
        import asyncio
        import time

        from uselemma_tracing import off_loop
        from uselemma_tracing.client import Lemma

        off_loop._awaited = off_loop._Pool(1, "uselemma-awaited-delivery")
        off_loop.OFF_LOOP_DRAIN_DEADLINE_SECONDS = 0.3


        def transport(_url, _headers, _body):
            time.sleep(1)
            print("sent", flush=True)
            return 201, "{}"


        lemma = Lemma(
            api_key="key",
            project_id="10000000-0000-0000-0000-000000000001",
            transport=transport,
        )


        async def run(_trace):
            return "ok"


        async def main():
            loop = asyncio.get_running_loop()
            for name in ("first", "second", "third"):
                loop.create_task(lemma.async_trace(name, run))
            await asyncio.sleep(0.1)


        asyncio.run(main())
        """
    )
    completed = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=30
    )

    assert completed.returncode == 0, completed.stderr
    # asyncio.run cancelled all three callers; the in-flight delivery still
    # went out, and the exit drain reported the two still queued.
    assert completed.stdout.split() == ["sent"]
    assert "2 deliveries still queued at exit." in completed.stderr
    assert "Traceback" not in completed.stderr


_request_id = contextvars.ContextVar("request_id")


async def test_async_trace_delivery_sees_the_callers_context_vars():
    _request_id.set("req-1")
    seen = []

    def before_send(payload):
        seen.append(_request_id.get(None))
        return payload

    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        transport=lambda *_args: (201, "{}"),
        before_send=before_send,
    )

    async def run(_trace):
        return "ok"

    assert await lemma.async_trace("support-agent", run) == "ok"
    assert seen == ["req-1"]


def test_a_thread_outliving_main_still_delivers_at_interpreter_shutdown():
    # Executors refuse new work once interpreter shutdown starts; delivery must
    # fall back to inline instead of raising out of async_trace or a sync hook.
    script = textwrap.dedent(
        """
        import asyncio
        import json
        import threading
        import time
        from datetime import datetime, timezone

        from uselemma_tracing.client import Lemma, TraceContext


        def transport(_url, _headers, body):
            print("sent", json.loads(body)["trace"]["name"], flush=True)
            return 201, "{}"


        lemma = Lemma(
            api_key="key",
            project_id="10000000-0000-0000-0000-000000000001",
            transport=transport,
        )


        async def run(_trace):
            return "ok"


        async def sync_hook():
            now = datetime.now(timezone.utc)
            lemma._deliver_automatic_without_blocking_loop(
                TraceContext(name="hook"), now, now
            )


        def outlive_main():
            time.sleep(0.5)
            print("result", asyncio.run(lemma.async_trace("awaited", run)), flush=True)
            asyncio.run(sync_hook())


        threading.Thread(target=outlive_main).start()
        """
    )
    completed = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=30
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.splitlines() == ["sent awaited", "result ok", "sent hook"]
    assert "Traceback" not in completed.stderr
