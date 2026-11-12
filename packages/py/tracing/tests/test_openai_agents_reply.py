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


def test_openai_agents_reply_text_for_streamed_response_and_chat_turn():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)

    processor.on_trace_start(FakeTrace(trace_id="trace_reply", name="support-agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_reply",
            span_id="span_reply",
            span_data={
                "type": "response",
                "_response": {
                    "model": "gpt-4.1",
                    "output": [
                        {
                            "type": "reasoning",
                            "encrypted_content": "gAAAA-secret-blob",
                        },
                        {
                            "type": "message",
                            "content": [
                                {"type": "output_text", "text": "It arrives Friday."}
                            ],
                        },
                    ],
                },
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_reply", name="support-agent"))

    processor.on_trace_start(FakeTrace(trace_id="trace_chat", name="support-agent"))
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_chat",
            span_id="span_chat",
            span_data={
                "type": "generation",
                "output": [
                    {
                        "role": "assistant",
                        "content": [
                            {"type": "reasoning", "text": "checking the shipment"},
                            {"type": "text", "text": "Ships Friday."},
                        ],
                    }
                ],
            },
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_chat", name="support-agent"))

    assert calls[0]["trace"]["output"] == "It arrives Friday."
    assert calls[0]["trace"]["spans"][0]["output"] == "It arrives Friday."
    assert "gAAAA-secret-blob" not in calls[0]["trace"]["output"]
    assert calls[1]["trace"]["output"] == "Ships Friday."
    assert calls[1]["trace"]["spans"][0]["output"] == "Ships Friday."
    assert "checking the shipment" not in calls[1]["trace"]["output"]
