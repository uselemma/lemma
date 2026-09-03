from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import pytest

from uselemma_tracing.client import Lemma, SpanHandle, TraceContext
from uselemma_tracing.debug_mode import disable_debug_mode, enable_debug_mode

PROJECT_ID = "10000000-0000-0000-0000-000000000001"


def test_default_urllib_transport_identifies_the_sdk(monkeypatch):
    requests = []

    class Response:
        status = 201
        headers = {}

        def read(self):
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def urlopen(request):
        requests.append(request)
        return Response()

    monkeypatch.setattr("uselemma_tracing.client.urllib.request.urlopen", urlopen)

    Lemma._urllib_transport(
        "https://api.example.test/traces/ingest",
        {"Authorization": "Bearer key"},
        b"{}",
    )
    Lemma._urllib_get(
        "https://api.example.test/traces/ingest-status",
        {"Authorization": "Bearer key"},
    )

    assert len(requests) == 2
    assert all(
        request.get_header("User-agent").startswith("uselemma-tracing/")
        for request in requests
    )


def test_lemma_trace_posts_completed_trace():
    calls = []

    def transport(url, headers, body):
        calls.append((url, headers, json.loads(body.decode())))
        return 201, "{}"

    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        base_url="https://api.example.test",
        transport=transport,
    )

    result = lemma.trace(
        "support-agent",
        lambda trace: (
            trace.record_tool(
                name="search_docs",
                input={"query": "order"},
                output={"status": "shipped"},
                duration_ms=25,
                tool_parameters={"query": "string"},
            ),
            trace.record_generation(
                name="draft-reply",
                input="prompt",
                output="answer",
                model="gpt-4o",
                duration_ms=40,
                llm_invocation_parameters={"temperature": 0.2},
                llm_input_messages=[{"role": "user", "content": "where is my order?"}],
            ),
            "it arrives Friday",
        )[-1],
        input="where is my order?",
        thread_id="thread-1",
        user_id="user-1",
        duration_ms=1234,
    )

    assert result == "it arrives Friday"
    assert len(calls) == 1
    url, headers, body = calls[0]
    assert url == "https://api.example.test/traces/ingest"
    assert headers["Authorization"] == "Bearer key"
    assert body["project_id"] == PROJECT_ID
    assert body["trace"]["name"] == "support-agent"
    assert body["trace"]["input"] == "where is my order?"
    assert body["trace"]["output"] == "it arrives Friday"
    assert body["trace"]["thread_id"] == "thread-1"
    assert body["trace"]["user_id"] == "user-1"
    assert body["trace"]["duration_ms"] == 1234
    assert body["trace"]["spans"][0]["type"] == "tool"
    assert body["trace"]["spans"][0]["duration_ms"] == 25
    assert body["trace"]["spans"][0]["attributes"] == {
        "tool.parameters": '{"query":"string"}',
        "lemma.sdk.language": "python",
        "lemma.sdk.integration": "manual",
    }
    assert body["trace"]["spans"][1]["type"] == "generation"
    assert body["trace"]["spans"][1]["duration_ms"] == 40
    assert body["trace"]["spans"][1]["attributes"] == {
        "llm.invocation_parameters": '{"temperature":0.2}',
        "llm.input_messages.0.message.role": "user",
        "llm.input_messages.0.message.content": "where is my order?",
        "llm.model_name": "gpt-4o",
        "gen_ai.request.model": "gpt-4o",
        "ai.model.id": "gpt-4o",
        "lemma.sdk.language": "python",
        "lemma.sdk.integration": "manual",
    }


def test_record_generation_emits_usage_wire_format_and_attributes():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    def run(trace):
        trace.record_generation(
            name="draft-reply",
            model="gpt-4o",
            llm_provider="openai",
            output="answer",
            input_tokens=100,
            output_tokens=20,
            cache_read_input_tokens=40,
            reasoning_output_tokens=5,
        )
        trace.record_generation(
            name="no-usage",
            model="gpt-4o",
            llm_provider="openai",
            output="b",
        )
        trace.record_generation(
            name="zero-usage",
            model="gpt-4o",
            llm_provider="openai",
            output="c",
            usage={"input_tokens": 0, "output_tokens": 0},
        )
        return "ok"

    lemma.trace("support-agent", run)

    spans = calls[0]["trace"]["spans"]
    assert spans[0]["usage"] == {
        "input_tokens": 100,
        "output_tokens": 20,
        "cache_read_input_tokens": 40,
        "reasoning_output_tokens": 5,
    }
    assert spans[0]["attributes"]["gen_ai.usage.input_tokens"] == 100
    assert spans[0]["attributes"]["gen_ai.system"] == "openai"
    assert spans[0]["attributes"]["llm.provider"] == "openai"
    assert "usage" not in spans[1]
    assert "gen_ai.usage.input_tokens" not in spans[1]["attributes"]
    assert spans[2]["usage"] == {"input_tokens": 0, "output_tokens": 0}
    assert spans[2]["attributes"]["gen_ai.usage.input_tokens"] == 0


def test_lemma_trace_omits_unspecified_child_duration():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    lemma.trace(
        "support-agent",
        lambda trace: trace.record_tool(name="lookup", input={"id": "order-1"}),
        duration_ms=1000,
    )

    body = calls[0]
    assert "duration_ms" not in body["trace"]["spans"][0]


def test_lemma_trace_supports_record_aliases_and_live_tool_generation_handles():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    def run(trace):
        trace.record_tool(name="lookup", output={"ok": True}, duration_ms=10)
        trace.record_generation(name="draft", output="hello", duration_ms=20)

        tool = trace.start_tool(name="search_docs", input={"query": "order"})
        tool.end(output=[{"title": "Shipping"}], duration_ms=30)

        generation = trace.start_generation(name="answer", input="prompt")
        generation.end(output="It arrives Friday.", duration_ms=40)

        return "ok"

    lemma.trace("support-agent", run)

    spans = calls[0]["trace"]["spans"]
    assert spans[0]["type"] == "tool"
    assert spans[0]["duration_ms"] == 10
    assert spans[1]["type"] == "generation"
    assert spans[1]["duration_ms"] == 20
    assert spans[2]["type"] == "tool"
    assert spans[2]["duration_ms"] == 30
    assert spans[3]["type"] == "generation"
    assert spans[3]["duration_ms"] == 40


def test_user_facing_tool_message_preserves_raw_input():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    def run(trace):
        tool_input = {
            "message": "Your order arrives Friday.",
            "sendAsVoiceNote": False,
        }
        trace.record_tool(
            name="send_whatsapp",
            input=tool_input,
            output={"delivered": True},
            user_facing_message=tool_input["message"],
        )
        trace.record_tool(name="write_audit_log", input={"orderId": "123"})

    lemma.trace("support-agent", run)

    spans = calls[0]["trace"]["spans"]
    assert spans[0]["input"] == {
        "message": "Your order arrives Friday.",
        "sendAsVoiceNote": False,
    }
    assert spans[0]["attributes"] == {
        "lemma.tool.kind": "user_message",
        "lemma.tool.message": "Your order arrives Friday.",
        "lemma.sdk.language": "python",
        "lemma.sdk.integration": "manual",
    }
    assert spans[1]["attributes"] == {
        "lemma.sdk.language": "python",
        "lemma.sdk.integration": "manual",
    }


def test_live_tool_preserves_user_facing_message():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    def run(trace):
        tool = trace.start_tool(
            name="send_message",
            input={"body": "I found it."},
            user_facing_message="I found it.",
        )
        tool.end(output={"delivered": True})

    lemma.trace("support-agent", run)

    assert calls[0]["trace"]["spans"][0]["attributes"] == {
        "lemma.tool.kind": "user_message",
        "lemma.tool.message": "I found it.",
        "lemma.sdk.language": "python",
        "lemma.sdk.integration": "manual",
    }


def test_span_handle_preserves_existing_positional_constructor_order():
    trace = TraceContext("support-agent")
    started_at = datetime.now(timezone.utc)
    handle = SpanHandle(
        trace,
        "draft",
        None,
        None,
        None,
        "generation",
        "span-1",
        None,
        started_at,
        "gpt-4o",
        None,
        "openai",
    )

    assert handle.llm_provider == "openai"
    assert handle.user_facing_message is None


def test_lemma_trace_flushes_errors_and_reraises():
    calls = []

    def transport(url, headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    def run(trace):
        trace.record_tool(name="lookup", error=ValueError("missing"))
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        lemma.trace("support-agent", run)

    body = calls[0]
    assert body["trace"]["status"] == "ERROR"
    assert body["trace"]["error"] == "RuntimeError: boom"
    assert body["trace"]["spans"][0]["status"] == "ERROR"
    assert body["trace"]["spans"][0]["error"] == "ValueError: missing"


def test_lemma_keeps_failures_that_carry_no_readable_message():
    calls = []

    def transport(url, headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    context = TraceContext(id="trace-1", name="support-agent")
    context.record_tool(name="lookup", error="   ")
    context.fail("   ")
    lemma.ingest(context, started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))

    trace = calls[0]["trace"]
    assert trace["status"] == "ERROR"
    assert trace["error"] == "Error"
    assert trace["spans"][0]["status"] == "ERROR"
    assert trace["spans"][0]["error"] == "Error"


def test_lemma_trace_surfaces_ingest_failures():
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        transport=lambda _url, _headers, _body: (503, "nope"),
    )

    with pytest.raises(RuntimeError, match="failed to ingest trace"):
        lemma.trace("support-agent", lambda _trace: "ok")


def test_ingest_sends_a_self_built_trace_once_merging_by_default():
    calls = []

    def transport(url, headers, body):
        calls.append((url, headers, json.loads(body.decode())))
        return 201, "{}"

    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        base_url="https://api.example.test",
        transport=transport,
    )

    started_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    context = TraceContext(
        id="trace-1",
        name="cursor-agent-turn",
        input="do the thing",
        thread_id="conv-1",
    )
    context.record_tool(name="search_docs", duration_ms=25)
    context.output("done")

    lemma.ingest(context, started_at=started_at)

    assert len(calls) == 1
    url, headers, body = calls[0]
    assert url == "https://api.example.test/traces/ingest"
    assert headers["Authorization"] == "Bearer key"
    assert body["project_id"] == PROJECT_ID
    assert body["trace"]["id"] == "trace-1"
    assert body["trace"]["name"] == "cursor-agent-turn"
    assert body["trace"]["input"] == "do the thing"
    assert body["trace"]["thread_id"] == "conv-1"
    assert body["trace"]["output"] == "done"
    assert body["trace"]["started_at"] == "2026-01-01T00:00:00Z"
    assert body["trace"]["spans"][0]["name"] == "search_docs"
    assert body["trace"]["spans"][0]["type"] == "tool"


def test_ingest_sends_each_call_as_its_own_complete_delivery():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    started_at = datetime(2026, 1, 1, tzinfo=timezone.utc)

    context = TraceContext(id="trace-1", name="turn")
    context.record_generation(name="draft", model="gpt-4o")
    context.record_tool(name="lookup")
    lemma.ingest(context, started_at=started_at)

    assert len(calls) == 1
    body = calls[0]
    assert body["trace"]["id"] == "trace-1"
    assert body["trace"]["started_at"] == "2026-01-01T00:00:00Z"
    assert body["trace"]["spans"][0]["name"] == "draft"
    assert body["trace"]["spans"][0]["type"] == "generation"
    assert body["trace"]["spans"][1]["name"] == "lookup"
    assert body["trace"]["spans"][1]["type"] == "tool"


def test_ingest_surfaces_failures_without_fabricating_status():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 503, "nope"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    context = TraceContext(id="trace-1", name="t")
    context.record_tool(name="lookup")

    with pytest.raises(RuntimeError, match="failed to ingest trace"):
        lemma.ingest(context, started_at=_now_utc())

    assert calls[0]["trace"]["status"] is None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def test_debug_mode_logs_sanitized_span_summaries(capsys):
    def transport(_url, _headers, _body):
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    def run(trace):
        trace.record_tool(
            name="search_docs",
            input={"query": "secret query"},
            output={"status": "secret status"},
            duration_ms=25,
        )
        trace.record_generation(
            name="draft-reply",
            input="secret prompt",
            output="secret answer",
            model="gpt-test",
            duration_ms=40,
        )
        live_output = capsys.readouterr().out
        assert live_output.count("[LEMMA:client] span recorded") == 2
        assert "[LEMMA:client] sending trace" not in live_output
        assert "'name': 'search_docs'" in live_output
        assert "'type': 'tool'" in live_output
        assert "'duration_ms': 25" in live_output
        assert "'name': 'draft-reply'" in live_output
        assert "'type': 'generation'" in live_output
        assert "'model': 'gpt-test'" in live_output
        assert "secret query" not in live_output
        assert "secret prompt" not in live_output
        assert "secret answer" not in live_output
        return "secret result"

    enable_debug_mode()
    try:
        lemma.trace("support-agent", run, input="secret trace input")
    finally:
        disable_debug_mode()

    output = capsys.readouterr().out
    assert "[LEMMA:client] sending trace" in output
    assert "'span_count': 2" in output
    assert "secret result" not in output


def test_debug_mode_logs_live_span_handles(capsys):
    def transport(_url, _headers, _body):
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    def run(trace):
        span = trace.start_tool(name="search_docs", input={"query": "secret query"})
        started_output = capsys.readouterr().out
        assert "[LEMMA:client] span started" in started_output
        assert "'id':" in started_output
        assert "'name': 'search_docs'" in started_output
        assert "'type': 'tool'" in started_output
        assert "'has_input': True" in started_output
        assert "'has_output': False" in started_output
        assert "secret query" not in started_output

        span.end(output={"status": "secret status"}, duration_ms=25)
        ended_output = capsys.readouterr().out
        assert "[LEMMA:client] span ended" in ended_output
        assert "'name': 'search_docs'" in ended_output
        assert "'type': 'tool'" in ended_output
        assert "'duration_ms': 25" in ended_output
        assert "'has_input': True" in ended_output
        assert "'has_output': True" in ended_output
        assert "secret status" not in ended_output
        return "ok"

    enable_debug_mode()
    try:
        lemma.trace("support-agent", run)
    finally:
        disable_debug_mode()


async def test_lemma_async_trace_posts_completed_trace():
    calls = []

    def transport(url, headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)

    async def run(trace):
        trace.record_generation(name="answer", output="hello")
        return "hello"

    result = await lemma.async_trace("async-agent", run, input="hi")

    assert result == "hello"
    assert calls[0]["trace"]["name"] == "async-agent"
    assert calls[0]["trace"]["output"] == "hello"
    assert calls[0]["trace"]["spans"][0]["type"] == "generation"


def test_debug_mode_logs_init_config_once(capsys):
    enable_debug_mode()
    try:
        lemma = Lemma(
            api_key="sk_test_12345678",
            project_id=PROJECT_ID,
            base_url="http://localhost:8000",
            transport=lambda *_args: (201, "{}"),
        )
        # Different instance still logs (per-instance banner).
        Lemma(
            api_key="sk_test_12345678",
            project_id=PROJECT_ID,
            transport=lambda *_args: (201, "{}"),
        )
        # Same instance does not re-log.
        lemma._log_init_config_once()
        output = capsys.readouterr().out
        assert output.count("[LEMMA:client] initialized") == 2
        assert "http://localhost:8000" in output
        assert "...5678" in output
    finally:
        disable_debug_mode()


def test_debug_smoke_test_returns_structured_diagnostics(monkeypatch):
    calls = {"status": 0, "ingest": 0}

    def transport(url, headers, body):
        calls["ingest"] += 1
        assert url.endswith("/traces/ingest")
        return 201, "{}", {"cf-ray": "ray-smoke", "server": "cloudflare"}

    def fake_get(url, headers):
        calls["status"] += 1
        assert "/traces/ingest-status" in url
        assert "otel_trace_id=" in url
        # First poll is not_found so smoke waits and retries.
        status = "not_found" if calls["status"] == 1 else "enqueued"
        return 200, json.dumps({"status": status}), {}

    monkeypatch.setattr(Lemma, "_urllib_get", staticmethod(fake_get))
    monkeypatch.setattr("uselemma_tracing.client.time.sleep", lambda _seconds: None)

    lemma = Lemma(
        api_key="sk_test_12345678",
        project_id=PROJECT_ID,
        base_url="https://api.example.test",
        transport=transport,
    )
    result = lemma.debug_smoke_test()

    assert result["ok"] is True
    assert result["config"]["apiKeySuffix"] == "...5678"
    assert result["ingest"]["status"] == 201
    assert result["ingest"]["responseHeaders"]["cf-ray"] == "ray-smoke"
    assert result["ingestStatus"] == "enqueued"
    assert calls["ingest"] == 1
    assert calls["status"] == 2


def test_debug_smoke_test_not_ok_when_ingest_status_fails(monkeypatch):
    def transport(url, headers, body):
        return 201, "{}", {"cf-ray": "ray-smoke"}

    def fake_get(url, headers):
        return 503, "nope", {}

    monkeypatch.setattr(Lemma, "_urllib_get", staticmethod(fake_get))

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    result = lemma.debug_smoke_test()
    assert result["ok"] is False
    assert "ingest-status check failed after ingest (status/network)" in result["hints"]


def test_debug_verify_polls_only_when_debug_mode_enabled(monkeypatch, capsys):
    enable_debug_mode()
    os.environ["LEMMA_DEBUG_VERIFY"] = "true"
    calls = {"status": 0}

    def transport(url, headers, body):
        return 201, "{}"

    def fake_get(url, headers):
        calls["status"] += 1
        assert "/traces/ingest-status" in url
        return 200, '{"status": "enqueued"}', {}

    monkeypatch.setattr(Lemma, "_urllib_get", staticmethod(fake_get))
    try:
        lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
        lemma.trace("verify-path", lambda _trace: "ok")
        assert calls["status"] == 1
        assert "trace enqueued (status=enqueued)" in capsys.readouterr().out
    finally:
        disable_debug_mode()
        os.environ.pop("LEMMA_DEBUG_VERIFY", None)


def test_debug_verify_retries_until_timeout(monkeypatch, capsys):
    enable_debug_mode()
    os.environ["LEMMA_DEBUG_VERIFY"] = "true"
    calls = {"status": 0}
    clock = {"now": 0.0}

    def transport(url, headers, body):
        return 201, "{}"

    def fake_get(url, headers):
        calls["status"] += 1
        return 200, '{"status": "not_found"}', {}

    def fake_monotonic():
        return clock["now"]

    def fake_sleep(seconds):
        clock["now"] += seconds

    monkeypatch.setattr(Lemma, "_urllib_get", staticmethod(fake_get))
    monkeypatch.setattr("uselemma_tracing.client.time.monotonic", fake_monotonic)
    monkeypatch.setattr("uselemma_tracing.client.time.sleep", fake_sleep)
    try:
        lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
        lemma.trace("verify-timeout", lambda _trace: "ok")
        assert calls["status"] > 1
        assert "ingest-status=not_found after 15s" in capsys.readouterr().out
    finally:
        disable_debug_mode()
        os.environ.pop("LEMMA_DEBUG_VERIFY", None)


def test_debug_verify_alone_does_not_poll(monkeypatch):
    os.environ["LEMMA_DEBUG_VERIFY"] = "true"
    calls = {"status": 0}

    def transport(url, headers, body):
        return 201, "{}"

    def fake_get(url, headers):
        calls["status"] += 1
        return 200, '{"status": "enqueued"}', {}

    monkeypatch.setattr(Lemma, "_urllib_get", staticmethod(fake_get))
    try:
        lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
        lemma.trace("no-verify", lambda _trace: "ok")
        assert calls["status"] == 0
    finally:
        os.environ.pop("LEMMA_DEBUG_VERIFY", None)


def _release_transport(calls):
    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    return transport


def test_constructor_release_is_stamped_on_every_ingest_payload():
    calls = []
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        release="1.8.3",
        transport=_release_transport(calls),
    )
    lemma.trace("support-agent", lambda _trace: "ok")
    lemma.trace("support-agent", lambda _trace: "again")

    assert len(calls) == 2
    assert calls[0]["trace"]["release"] == "1.8.3"
    assert calls[1]["trace"]["release"] == "1.8.3"


def test_lemma_release_env_used_when_constructor_omits_release(monkeypatch):
    monkeypatch.setenv("LEMMA_RELEASE", "env-1.0.0")
    calls = []
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        transport=_release_transport(calls),
    )
    lemma.trace("support-agent", lambda _trace: "ok")
    assert calls[0]["trace"]["release"] == "env-1.0.0"


def test_constructor_release_wins_over_env(monkeypatch):
    monkeypatch.setenv("LEMMA_RELEASE", "env-1.0.0")
    calls = []
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        release="1.8.3",
        transport=_release_transport(calls),
    )
    lemma.trace("support-agent", lambda _trace: "ok")
    assert calls[0]["trace"]["release"] == "1.8.3"


@pytest.mark.parametrize(
    "release",
    ["", "   ", "v1\n2", "v1\t2", "v1\r2", "a" * 201],
)
def test_empty_and_invalid_release_omits_the_field(release):
    calls = []
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        release=release,
        transport=_release_transport(calls),
    )
    lemma.trace("support-agent", lambda _trace: "ok")
    assert "release" not in calls[0]["trace"]


def test_explicit_empty_release_does_not_fall_back_to_env(monkeypatch):
    monkeypatch.setenv("LEMMA_RELEASE", "env-1.0.0")
    calls = []
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        release="",
        transport=_release_transport(calls),
    )
    lemma.trace("support-agent", lambda _trace: "ok")
    assert "release" not in calls[0]["trace"]


def test_release_is_trimmed_from_constructor_and_env(monkeypatch):
    calls = []
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        release="  1.8.3  ",
        transport=_release_transport(calls),
    )
    lemma.trace("support-agent", lambda _trace: "ok")
    assert calls[0]["trace"]["release"] == "1.8.3"

    monkeypatch.setenv("LEMMA_RELEASE", "  env-1.0.0  ")
    env_calls = []
    env_lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        transport=_release_transport(env_calls),
    )
    env_lemma.trace("support-agent", lambda _trace: "ok")
    assert env_calls[0]["trace"]["release"] == "env-1.0.0"


def test_ingest_stamps_client_release():
    calls = []
    lemma = Lemma(
        api_key="key",
        project_id=PROJECT_ID,
        release="1.8.3",
        transport=_release_transport(calls),
    )
    context = TraceContext(id="trace-1", name="turn")
    lemma.ingest(context, started_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert calls[0]["trace"]["release"] == "1.8.3"


class _AgentError(Exception):
    pass


def _failing_transport(bodies):
    def transport(_url, _headers, body):
        bodies.append(json.loads(body.decode()))
        return 503, "nope"

    return transport


def test_trace_reraises_the_agent_error_when_delivery_fails():
    bodies = []
    lemma = Lemma(
        api_key="key", project_id=PROJECT_ID, transport=_failing_transport(bodies)
    )

    def agent(_trace):
        raise _AgentError("tool timed out")

    with pytest.warns(RuntimeWarning, match="could not deliver the trace"):
        with pytest.raises(_AgentError, match="tool timed out"):
            lemma.trace("support-agent", agent)

    # The failed trace was still attempted, and recorded the agent's error.
    assert len(bodies) == 1
    assert bodies[0]["trace"]["status"] == "ERROR"
    assert bodies[0]["trace"]["error"] == "_AgentError: tool timed out"


async def test_async_trace_reraises_the_agent_error_when_delivery_fails():
    bodies = []
    lemma = Lemma(
        api_key="key", project_id=PROJECT_ID, transport=_failing_transport(bodies)
    )

    async def agent(_trace):
        raise _AgentError("premature termination")

    with pytest.warns(RuntimeWarning):
        with pytest.raises(_AgentError, match="premature termination"):
            await lemma.async_trace("support-agent", agent)

    assert len(bodies) == 1
    assert bodies[0]["trace"]["error"] == "_AgentError: premature termination"


def test_trace_does_not_resend_a_successful_run_as_a_failed_one():
    # A transport failure must not fabricate an error status on the trace.
    bodies = []
    lemma = Lemma(
        api_key="key", project_id=PROJECT_ID, transport=_failing_transport(bodies)
    )

    with pytest.raises(RuntimeError, match="failed to ingest trace"):
        lemma.trace("support-agent", lambda _trace: "ok")

    assert len(bodies) == 1
    assert bodies[0]["trace"].get("status") is None
    assert bodies[0]["trace"].get("error") is None
    assert bodies[0]["trace"]["output"] == "ok"
