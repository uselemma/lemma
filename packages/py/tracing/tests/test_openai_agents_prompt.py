from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from uselemma_tracing import openai_agents
from uselemma_tracing.client import Lemma

PROJECT_ID = "10000000-0000-0000-0000-000000000001"


@dataclass
class FakeTrace:
    trace_id: str
    name: str


@dataclass
class FakeSpan:
    trace_id: str
    span_id: str
    span_data: Any


def test_openai_agents_span_data_omits_prompt_bodies():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)
    prompt = "PROMPT-BODY-once-history"
    instructions = "SYSTEM-BODY-once"
    reply = "OUTPUT-BODY-once"
    tools = [{"type": "function", "name": "lookup_order"}]

    processor.on_trace_start(FakeTrace(trace_id="trace_once_prompt", name="support-agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_once_prompt",
            span_id="span_once",
            span_data={
                "type": "response",
                "_input": [{"role": "user", "content": prompt}],
                "_response": {
                    "model": "gpt-4.1",
                    "instructions": instructions,
                    "tools": tools,
                    "usage": {"input_tokens": 12, "output_tokens": 4},
                    "output": [
                        {
                            "type": "message",
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": reply}],
                        }
                    ],
                },
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_once_prompt", name="support-agent"))

    span = calls[0]["trace"]["spans"][0]
    span_data = json.loads(span["attributes"]["openai.agents.span_data"])
    assert span["input"] == [{"role": "user", "content": prompt}]
    assert span["output"] == reply
    assert span["attributes"]["llm.model_name"] == "gpt-4.1"
    assert span["attributes"]["llm.input_messages.1.message.content"] == prompt
    assert json.loads(span["attributes"]["llm.tools"]) == tools
    assert span["usage"]["input_tokens"] == 12
    assert span["usage"]["output_tokens"] == 4
    assert span_data["_response"]["model"] == "gpt-4.1"
    assert span_data["_response"]["tools"] == tools
    assert "output" not in span_data["_response"]
    assert "instructions" not in span_data["_response"]
    assert "_input" not in span_data
    raw = span["attributes"]["openai.agents.span_data"]
    assert prompt not in raw
    assert instructions not in raw
    assert reply not in raw


def test_openai_agents_live_response_input_is_omitted_from_span_data():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    class LiveResponse:
        model = "gpt-4.1"
        instructions = "LIVE-SYSTEM-once"
        output = [{"type": "message", "content": "LIVE-OUTPUT-once"}]
        tools = [{"type": "function", "name": "lookup_order"}]

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)
    prompt = "LIVE-INPUT-once-history"
    processor.on_trace_start(FakeTrace(trace_id="trace_live_input", name="support-agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_live_input",
            span_id="span_live",
            span_data={
                "type": "response",
                "input": [{"role": "user", "content": prompt}],
                "response": LiveResponse(),
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_live_input", name="support-agent"))

    span = calls[0]["trace"]["spans"][0]
    span_data = json.loads(span["attributes"]["openai.agents.span_data"])
    assert span["input"] == [{"role": "user", "content": prompt}]
    assert span["output"] == "LIVE-OUTPUT-once"
    assert "input" not in span_data
    assert span_data["response"]["model"] == "gpt-4.1"
    assert span_data["response"]["tools"] == [{"type": "function", "name": "lookup_order"}]
    assert "output" not in span_data["response"]
    assert "instructions" not in span_data["response"]
    raw = span["attributes"]["openai.agents.span_data"]
    assert prompt not in raw
    assert "LIVE-OUTPUT-once" not in raw
    assert "LIVE-SYSTEM-once" not in raw
