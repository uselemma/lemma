from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from uselemma_tracing import disable_debug_mode, enable_debug_mode, openai_agents
from uselemma_tracing.client import Lemma

PROJECT_ID = "10000000-0000-0000-0000-000000000001"


@dataclass
class FakeTrace:
    trace_id: str
    name: str
    group_id: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class FakeSpan:
    trace_id: str
    span_id: str
    span_data: Any
    parent_id: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    error: dict[str, Any] | None = None
    trace_metadata: dict[str, Any] | None = None


class LiveFunctionSpanData:
    """Mirrors SDK objects where export() stringifies structured tool output."""

    type = "function"
    name = "pdf_server_pdf"

    def __init__(self, output: Any) -> None:
        self.output = output
        self.input = '{"query":"YAT"}'

    def export(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "name": self.name,
            "input": self.input,
            "output": json.dumps(self.output),
        }


class LiveResponseSpanData:
    """Mirrors SDK objects where export() omits the live response object."""

    type = "response"
    model = "gpt-4o"

    def __init__(self) -> None:
        self.input = [{"role": "user", "content": "status?"}]
        self.response = {
            "output_text": "Shipped yesterday.",
            "output": [{"type": "message", "content": [{"text": "Shipped yesterday."}]}],
        }

    def export(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "model": self.model,
            "input": self.input,
            # intentionally omit response — live attr must win
        }


def test_openai_agents_records_generations_and_function_children():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(
        FakeTrace(
            trace_id="trace_openai_1",
            name="support-agent",
            group_id="thread-1",
            metadata={"user_id": "user-1"},
        )
    )
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_openai_1",
            span_id="span_generation_1",
            started_at="2026-06-29T10:00:00Z",
            span_data={
                "type": "generation",
                "input": [{"role": "user", "content": "where is my order?"}],
                "model": "gpt-4o",
                "model_config": {"temperature": 0.2},
            },
        )
    )
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_openai_1",
            span_id="span_tool_1",
            parent_id="span_generation_1",
            started_at="2026-06-29T10:00:00.050Z",
            span_data={
                "type": "function",
                "name": "search_docs",
                "input": json.dumps({"query": "order"}),
            },
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_openai_1",
            span_id="span_tool_1",
            parent_id="span_generation_1",
            started_at="2026-06-29T10:00:00.050Z",
            ended_at="2026-06-29T10:00:00.090Z",
            span_data={
                "type": "function",
                "name": "search_docs",
                "input": json.dumps({"query": "order"}),
                "output": json.dumps([{"title": "Shipping"}]),
            },
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_openai_1",
            span_id="span_generation_1",
            started_at="2026-06-29T10:00:00Z",
            ended_at="2026-06-29T10:00:00.125Z",
            span_data={
                "type": "generation",
                "input": [{"role": "user", "content": "where is my order?"}],
                "output": [{"role": "assistant", "content": "It arrives Friday."}],
                "model": "gpt-4o",
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_openai_1", name="support-agent"))

    assert len(calls) == 1
    trace = calls[0]["trace"]
    assert trace["name"] == "support-agent"
    assert trace["thread_id"] == "thread-1"
    assert trace["user_id"] == "user-1"
    assert trace["input"] == "where is my order?"
    assert trace["output"] == "It arrives Friday."
    assert trace["duration_ms"] == 125
    assert datetime.fromisoformat(trace["started_at"].replace("Z", "+00:00")) == datetime.fromisoformat(
        "2026-06-29T10:00:00+00:00"
    )
    assert datetime.fromisoformat(trace["ended_at"].replace("Z", "+00:00")) == datetime.fromisoformat(
        "2026-06-29T10:00:00.125+00:00"
    )
    assert trace["metadata"]["openai_agents_trace_id"] == "trace_openai_1"
    assert trace["spans"][0]["id"] == "span_generation_1"
    assert trace["spans"][0]["type"] == "generation"
    assert trace["spans"][0]["output"] == "It arrives Friday."
    assert trace["spans"][0]["model"] == "gpt-4o"
    assert trace["spans"][0]["duration_ms"] == 125
    assert trace["spans"][0]["ended_at"] == "2026-06-29T10:00:00.125Z"
    assert trace["spans"][0]["attributes"]["llm.provider"] == "openai"
    assert (
        trace["spans"][0]["attributes"]["llm.input_messages.0.message.content"]
        == "where is my order?"
    )
    assert trace["spans"][1]["id"] == "span_tool_1"
    assert trace["spans"][1]["parent_id"] == "span_generation_1"
    assert trace["spans"][1]["type"] == "tool"
    assert trace["spans"][1]["input"] == {"query": "order"}
    assert trace["spans"][1]["output"] == [{"title": "Shipping"}]
    assert trace["spans"][1]["duration_ms"] == 40
    assert trace["spans"][1]["ended_at"] == "2026-06-29T10:00:00.090Z"


def test_openai_agents_sends_once_and_does_not_resend_on_shutdown():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(FakeTrace(trace_id="trace_once", name="agent"))
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_once",
            span_id="span_gen",
            span_data={"type": "generation", "model": "gpt-4o"},
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_once",
            span_id="span_gen",
            span_data={
                "type": "generation",
                "model": "gpt-4o",
                "output": [{"role": "assistant", "content": "hi"}],
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_once", name="agent"))

    assert len(calls) == 1

    # A shutdown/force_flush after the trace already ended must not re-send it,
    # which would duplicate every span in the append-only ingest store.
    processor.force_flush()
    processor.shutdown()

    assert len(calls) == 1


def test_openai_agents_force_flush_sends_open_trace_once():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(FakeTrace(trace_id="trace_open", name="agent"))
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_open",
            span_id="span_gen",
            span_data={"type": "generation", "model": "gpt-4o"},
        )
    )

    # A trace that never receives on_trace_end is finalized once on shutdown...
    processor.force_flush()
    assert len(calls) == 1

    # ...and a late on_trace_end (or a second flush) does not resend it.
    processor.on_trace_end(FakeTrace(trace_id="trace_open", name="agent"))
    processor.force_flush()
    assert len(calls) == 1


def test_openai_agents_records_is_error_function_output_as_error():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(FakeTrace(trace_id="trace_err", name="support-agent"))
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_err",
            span_id="span_tool",
            span_data={
                "type": "function",
                "name": "pdf_server_pdf",
                "input": '{"query":"YAT"}',
            },
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_err",
            span_id="span_tool",
            span_data={
                "type": "function",
                "name": "pdf_server_pdf",
                "input": '{"query":"YAT"}',
                "output": json.dumps(
                    {
                        "content": [
                            {"type": "text", "text": "Internal error: Validation error"}
                        ],
                        "isError": True,
                    }
                ),
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_err", name="support-agent"))

    span = calls[0]["trace"]["spans"][0]
    assert span["name"] == "pdf_server_pdf"
    assert span["status"] == "ERROR"
    assert span["error"] == "Internal error: Validation error"
    assert "output" not in span
    # Soft tool error alone must not fail the root trace.
    assert calls[0]["trace"].get("status") != "ERROR"
    assert calls[0]["trace"].get("error") in (None, )


def test_openai_agents_live_function_output_prefers_structured_is_error():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    live_output = {
        "isError": True,
        "content": [{"type": "text", "text": "live structured error"}],
    }
    processor.on_trace_start(FakeTrace(trace_id="trace_live_fn", name="agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_live_fn",
            span_id="span_tool",
            span_data=LiveFunctionSpanData(live_output),
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_live_fn", name="agent"))

    span = calls[0]["trace"]["spans"][0]
    assert span["status"] == "ERROR"
    assert span["error"] == "live structured error"
    assert "output" not in span


def test_openai_agents_mastra_style_error_true_tool_output():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(FakeTrace(trace_id="trace_mastra", name="agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_mastra",
            span_id="span_tool",
            span_data={
                "type": "function",
                "name": "ship",
                "output": {
                    "error": True,
                    "message": "Tool input validation failed for ship",
                },
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_mastra", name="agent"))

    span = calls[0]["trace"]["spans"][0]
    assert span["status"] == "ERROR"
    assert span["error"] == "Tool input validation failed for ship"
    assert "output" not in span


def test_openai_agents_response_span_reads_live_response_attributes():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(FakeTrace(trace_id="trace_resp", name="agent"))
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_resp",
            span_id="span_resp",
            started_at="2026-06-29T11:00:00Z",
            span_data=LiveResponseSpanData(),
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_resp",
            span_id="span_resp",
            started_at="2026-06-29T11:00:00Z",
            ended_at="2026-06-29T11:00:00.050Z",
            span_data=LiveResponseSpanData(),
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_resp", name="agent"))

    trace = calls[0]["trace"]
    assert trace["input"] == "status?"
    assert trace["output"] == "Shipped yesterday."
    span = trace["spans"][0]
    assert span["type"] == "generation"
    assert span["output"] == "Shipped yesterday."


def test_openai_agents_record_inputs_outputs_false():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma, record_inputs=False, record_outputs=False)

    processor.on_trace_start(FakeTrace(trace_id="trace_privacy", name="agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_privacy",
            span_id="span_gen",
            started_at="2026-06-29T12:00:00Z",
            ended_at="2026-06-29T12:00:00.010Z",
            span_data={
                "type": "generation",
                "input": [{"role": "user", "content": "secret prompt"}],
                "output": [{"role": "assistant", "content": "secret answer"}],
                "model": "gpt-4o",
            },
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_privacy",
            span_id="span_agent",
            started_at="2026-06-29T12:00:00Z",
            ended_at="2026-06-29T12:00:00.020Z",
            error={"message": "agent failed hard"},
            span_data={"type": "agent", "name": "support"},
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_privacy", name="agent"))

    trace = calls[0]["trace"]
    assert trace.get("input") is None
    assert trace.get("output") is None
    assert trace["status"] == "ERROR"
    assert trace["error"] == "error"
    gen = next(span for span in trace["spans"] if span["id"] == "span_gen")
    assert gen.get("input") is None
    assert gen.get("output") is None


def test_openai_agents_root_hard_error_not_soft_tool_alone():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(FakeTrace(trace_id="trace_hard", name="agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_hard",
            span_id="span_tool",
            span_data={
                "type": "function",
                "name": "lookup",
                "output": {"isError": True, "content": [{"type": "text", "text": "soft"}]},
            },
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_hard",
            span_id="span_gen",
            span_data={
                "type": "generation",
                "input": [{"role": "user", "content": "retry"}],
                "output": [{"role": "assistant", "content": "recovered"}],
                "model": "gpt-4o",
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_hard", name="agent"))

    trace = calls[0]["trace"]
    assert trace.get("status") != "ERROR"
    assert trace.get("error") in (None,)
    assert trace["output"] == "recovered"

    calls.clear()
    processor = openai_agents(lemma)
    processor.on_trace_start(FakeTrace(trace_id="trace_hard2", name="agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_hard2",
            span_id="span_agent",
            error={"message": "guardrail blocked"},
            span_data={"type": "guardrail", "name": "safety"},
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_hard2", name="agent"))

    trace = calls[0]["trace"]
    assert trace["status"] == "ERROR"
    assert trace["error"] == "guardrail blocked"


def test_openai_agents_configurable_identity_keys():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(
        lemma,
        thread_id_key="conversation_id",
        user_id_key="customer_id",
    )

    processor.on_trace_start(
        FakeTrace(
            trace_id="trace_ids",
            name="agent",
            metadata={
                "conversation_id": "conv-9",
                "customer_id": "cust-3",
                "user_id": "ignored",
            },
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_ids",
            span_id="span_gen",
            span_data={
                "type": "generation",
                "output": [{"role": "assistant", "content": "ok"}],
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_ids", name="agent"))

    trace = calls[0]["trace"]
    assert trace["thread_id"] == "conv-9"
    assert trace["user_id"] == "cust-3"


def test_openai_agents_ignores_orphan_spans_without_trace():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_span_start(
        FakeSpan(
            trace_id="missing",
            span_id="orphan",
            span_data={"type": "generation", "model": "gpt-4o"},
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="missing",
            span_id="orphan",
            span_data={
                "type": "generation",
                "output": [{"role": "assistant", "content": "nope"}],
            },
        )
    )
    assert calls == []


def test_openai_agents_extends_parent_when_child_tool_ends_later():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(FakeTrace(trace_id="trace_timing", name="support-agent"))
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_timing",
            span_id="span_generation",
            span_data={"type": "generation", "model": "gpt-4o"},
            started_at="2026-06-29T10:00:00.000Z",
        )
    )
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_timing",
            span_id="span_tool",
            parent_id="span_generation",
            span_data={"type": "function", "name": "search_docs"},
            started_at="2026-06-29T10:00:00.050Z",
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_timing",
            span_id="span_generation",
            span_data={
                "type": "generation",
                "model": "gpt-4o",
                "output": [{"role": "assistant", "content": "done"}],
            },
            started_at="2026-06-29T10:00:00.000Z",
            ended_at="2026-06-29T10:00:00.100Z",
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_timing",
            span_id="span_tool",
            parent_id="span_generation",
            span_data={
                "type": "function",
                "name": "search_docs",
                "output": '{"ok":true}',
            },
            started_at="2026-06-29T10:00:00.050Z",
            ended_at="2026-06-29T10:00:00.180Z",
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_timing", name="support-agent"))

    spans = {span["id"]: span for span in calls[0]["trace"]["spans"]}

    def parse_ts(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    assert parse_ts(spans["span_generation"]["ended_at"]) >= parse_ts(
        spans["span_tool"]["ended_at"]
    )
    assert calls[0]["trace"]["duration_ms"] == 180


def test_openai_agents_debug_logs_live_child_parent(capsys):
    def transport(_url, _headers, _body):
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    enable_debug_mode()
    try:
        processor.on_trace_start(FakeTrace(trace_id="trace_openai_2", name="debug-agent"))
        processor.on_span_start(
            FakeSpan(
                trace_id="trace_openai_2",
                span_id="span_generation_2",
                span_data={"type": "generation", "model": "gpt-4o"},
            )
        )
        processor.on_span_start(
            FakeSpan(
                trace_id="trace_openai_2",
                span_id="span_tool_2",
                parent_id="span_generation_2",
                span_data={"type": "function", "name": "lookup", "input": "{}"},
            )
        )
        output = capsys.readouterr().out
        assert "[LEMMA:client] span started" in output
        assert "'id': 'span_generation_2'" in output
        assert "'id': 'span_tool_2'" in output
        assert "'parent_id': 'span_generation_2'" in output
        assert "'type': 'tool'" in output

        processor.on_span_end(
            FakeSpan(
                trace_id="trace_openai_2",
                span_id="span_tool_2",
                parent_id="span_generation_2",
                span_data={
                    "type": "function",
                    "name": "lookup",
                    "input": "{}",
                    "output": "{}",
                },
            )
        )
        output = capsys.readouterr().out
        assert "[LEMMA:client] span ended" in output
        assert "'parent_id': 'span_generation_2'" in output
        assert "'has_output': True" in output
    finally:
        disable_debug_mode()
