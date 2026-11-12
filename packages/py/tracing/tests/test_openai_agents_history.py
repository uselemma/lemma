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


def test_openai_agents_history_items_get_roles():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)
    history = [
        {"role": "user", "content": "look up the order"},
        {
            "type": "function_call",
            "call_id": "call_1",
            "name": "lookup_order",
            "arguments": "{}",
        },
        {"type": "function_call_output", "call_id": "call_1", "output": "Friday"},
        {"type": "reasoning", "id": "rs_1", "summary": []},
        {"type": "function_call_result", "call_id": "call_2", "output": "kept"},
        {"type": "function_call", "role": "user", "name": "custom"},
    ]

    processor.on_trace_start(FakeTrace(trace_id="trace_roles", name="support-agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_roles",
            span_id="span_roles",
            span_data={
                "type": "response",
                "_input": history,
                "_response": {
                    "model": "gpt-4.1",
                    "output": [
                        {"type": "message", "role": "assistant", "content": "Friday"}
                    ],
                },
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_roles", name="support-agent"))

    attributes = calls[0]["trace"]["spans"][0]["attributes"]
    assert attributes["llm.input_messages.0.message.role"] == "user"
    assert attributes["llm.input_messages.1.message.role"] == "assistant"
    assert attributes["llm.input_messages.1.message.type"] == "function_call"
    assert attributes["llm.input_messages.2.message.role"] == "tool"
    assert attributes["llm.input_messages.2.message.type"] == "function_call_output"
    assert attributes["llm.input_messages.3.message.role"] == "assistant"
    assert attributes["llm.input_messages.3.message.type"] == "reasoning"
    assert attributes["llm.input_messages.4.message.role"] == "tool"
    assert attributes["llm.input_messages.4.message.type"] == "function_call_result"
    assert attributes["llm.input_messages.5.message.role"] == "user"


def test_openai_agents_non_mapping_response_stays_the_output():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)
    processor.on_trace_start(FakeTrace(trace_id="trace_raw", name="agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_raw",
            span_id="span_raw",
            span_data={"type": "response", "response": "raw-response-text"},
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_raw", name="agent"))
    assert calls[0]["trace"]["spans"][0]["output"] == "raw-response-text"
