"""Drive Lemma's OpenAI Agents processor through the real Agents SDK.

No network: local Model subclass + in-memory transport.
Replaces the default OpenAI trace backend so CI never calls api.openai.com.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest

pytest.importorskip("agents")

from agents import Agent, Runner, set_trace_processors, trace
from agents.items import ModelResponse
from agents.models.interface import Model
from agents.usage import Usage
from openai.types.responses import ResponseOutputMessage, ResponseOutputText

from uselemma_tracing import Lemma, instrument_openai_agents


def make_transport(calls):
    def transport(url, headers, body):
        calls.append(json.loads(body.decode()))
        return 201, "{}"

    return transport


class ScriptedModel(Model):
    """Deterministic Agents SDK model. Returns one assistant message."""

    def __init__(self, text: str) -> None:
        self._text = text

    async def get_response(self, *args: Any, **kwargs: Any) -> ModelResponse:
        return ModelResponse(
            output=[
                ResponseOutputMessage(
                    id="msg_scripted",
                    type="message",
                    role="assistant",
                    status="completed",
                    content=[
                        ResponseOutputText(
                            type="output_text",
                            text=self._text,
                            annotations=[],
                        )
                    ],
                )
            ],
            usage=Usage(
                requests=1,
                input_tokens=1,
                output_tokens=1,
                total_tokens=2,
            ),
            response_id="resp_scripted",
        )

    def stream_response(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        async def _empty() -> AsyncIterator[Any]:
            if False:
                yield None

        return _empty()


def test_instrumented_runner_sends_one_trace():
    calls = []
    lemma = Lemma(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
        transport=make_transport(calls),
    )
    processor = instrument_openai_agents(lemma=lemma)
    # Drop the default OpenAI exporter; keep only Lemma.
    set_trace_processors([processor])
    agent = Agent(
        name="support-agent",
        instructions="Be brief.",
        model=ScriptedModel("hello from agents"),
    )

    async def run_turn() -> str:
        with trace(
            "support-agent",
            group_id="thread-1",
            metadata={"user_id": "user-1"},
        ):
            result = await Runner.run(agent, "hi")
        return str(result.final_output or "")

    output = asyncio.run(run_turn())
    processor.force_flush()

    assert output == "hello from agents"
    assert len(calls) == 1
    trace_payload = calls[0]["trace"]
    assert trace_payload["name"] == "support-agent"
    assert trace_payload["thread_id"] == "thread-1"
    assert trace_payload["user_id"] == "user-1"
    assert any(span["type"] == "generation" for span in trace_payload["spans"])
