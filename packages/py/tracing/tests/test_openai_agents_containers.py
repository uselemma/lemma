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
    parent_id: str | None = None


def test_openai_agents_container_spans_take_child_generation_io():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)
    trace_id = "trace_containers"

    processor.on_trace_start(FakeTrace(trace_id=trace_id, name="support-agent"))
    processor.on_span_start(
        FakeSpan(trace_id=trace_id, span_id="span_turn", span_data={"type": "turn", "name": "turn"})
    )
    processor.on_span_start(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_task",
            parent_id="span_turn",
            span_data={"type": "task", "name": "task"},
        )
    )
    processor.on_span_start(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_agent_a",
            parent_id="span_task",
            span_data={"type": "agent", "name": "agent-a"},
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_gen_a",
            parent_id="span_agent_a",
            span_data={
                "type": "generation",
                "input": "ask A",
                "output": [{"role": "assistant", "content": "reply A"}],
            },
        )
    )
    processor.on_span_start(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_agent_b",
            parent_id="span_task",
            span_data={"type": "agent", "name": "agent-b"},
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_gen_b",
            parent_id="span_agent_b",
            span_data={
                "type": "generation",
                "input": "ask B",
                "output": [{"role": "assistant", "content": "reply B"}],
            },
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_agent_a",
            parent_id="span_task",
            span_data={"type": "agent", "name": "agent-a"},
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_agent_b",
            parent_id="span_task",
            span_data={"type": "agent", "name": "agent-b"},
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_task",
            parent_id="span_turn",
            span_data={"type": "task", "name": "task"},
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id=trace_id,
            span_id="span_turn",
            span_data={"type": "turn", "name": "turn"},
        )
    )
    processor.on_trace_end(FakeTrace(trace_id=trace_id, name="support-agent"))

    trace = calls[0]["trace"]
    by_id = {span["id"]: span for span in trace["spans"]}
    assert by_id["span_agent_a"]["input"] == "ask A"
    assert by_id["span_agent_a"]["output"] == "reply A"
    assert by_id["span_agent_b"]["input"] == "ask B"
    assert by_id["span_agent_b"]["output"] == "reply B"
    assert by_id["span_task"]["input"] == "ask A"
    assert by_id["span_task"]["output"] == "reply B"
    assert by_id["span_turn"]["input"] == "ask A"
    assert by_id["span_turn"]["output"] == "reply B"
    assert trace["input"] == "ask A"
    assert trace["output"] == "reply B"


def test_openai_agents_agent_keeps_its_own_input():
    calls = []

    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    lemma = Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)
    processor = openai_agents(lemma)
    processor.on_trace_start(FakeTrace(trace_id="trace_owned", name="agent"))
    processor.on_span_start(
        FakeSpan(
            trace_id="trace_owned",
            span_id="span_agent",
            span_data={"type": "agent", "name": "agent", "input": "owned"},
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_owned",
            span_id="span_gen",
            parent_id="span_agent",
            span_data={
                "type": "generation",
                "input": "child ask",
                "output": [{"role": "assistant", "content": "child reply"}],
            },
        )
    )
    processor.on_span_end(
        FakeSpan(
            trace_id="trace_owned",
            span_id="span_agent",
            span_data={"type": "agent", "name": "agent", "input": "owned"},
        )
    )
    processor.on_trace_end(FakeTrace(trace_id="trace_owned", name="agent"))

    agent = next(span for span in calls[0]["trace"]["spans"] if span["id"] == "span_agent")
    assert agent["input"] == "owned"
    assert agent["output"] == "child reply"
