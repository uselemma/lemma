"""Drive Lemma's LangChain handler through real LangChain / LangGraph.

These tests import the frameworks and call ainvoke. They catch handler-contract
bugs (missing run_inline) that the scripted callback tests cannot see.
No network: scripted chat model + in-memory transport.
"""

from __future__ import annotations

import asyncio
from typing import Any

from langchain.agents import create_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableLambda
from langchain_core.tools import tool
from langgraph.graph import END, START, MessagesState, StateGraph
from pydantic import PrivateAttr

from uselemma_tracing import langchain, langgraph


def make_transport(calls):
    def transport(url, headers, body):
        import json

        calls.append(json.loads(body.decode()))
        return 201, "{}"

    return transport


class ScriptedChatModel(BaseChatModel):
    """Deterministic chat model. Returns queued AIMessages in order."""

    responses: list[AIMessage]
    _index: int = PrivateAttr(default=0)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Any, **kwargs: Any) -> ScriptedChatModel:
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        if self._index >= len(self.responses):
            message = AIMessage(content="done")
        else:
            message = self.responses[self._index]
            self._index += 1
        return ChatResult(generations=[ChatGeneration(message=message)])


def _handler(calls, **options):
    return langchain(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
        transport=make_transport(calls),
        **options,
    )


def test_callback_manager_accepts_handler():
    """LangChain 1.6 reads handler.run_inline on the manager, not via getattr."""
    from langchain_core.callbacks.manager import CallbackManager

    handler = _handler([])
    manager = CallbackManager.configure(inheritable_callbacks=[handler])
    assert manager.handlers
    assert manager.handlers[0].run_inline is False


def test_runnable_ainvoke_sends_one_trace():
    calls = []
    handler = _handler(calls, agent_name="support-agent")
    chain = RunnableLambda(lambda text: f"echo:{text}")

    result = asyncio.run(
        chain.ainvoke(
            "hello",
            config={
                "callbacks": [handler],
                "metadata": {"thread_id": "thread-1", "user_id": "user-1"},
            },
        )
    )
    handler.flush()

    assert result == "echo:hello"
    assert len(calls) == 1
    trace = calls[0]["trace"]
    assert trace["name"] == "support-agent"
    assert trace["thread_id"] == "thread-1"
    assert trace["user_id"] == "user-1"


def test_create_agent_ainvoke_is_one_root_with_tool_and_generation():
    calls = []
    handler = _handler(calls, agent_name="support-agent")

    @tool
    def ping() -> str:
        """Return pong."""
        return "pong"

    model = ScriptedChatModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[{"name": "ping", "args": {}, "id": "call_1"}],
            ),
            AIMessage(content="pong from docs"),
        ]
    )
    agent = create_agent(
        model=model,
        tools=[ping],
        system_prompt="Be brief.",
        name="support-agent",
    )

    result = asyncio.run(
        agent.ainvoke(
            {"messages": [{"role": "user", "content": "ping"}]},
            {
                "callbacks": [handler],
                "metadata": {"thread_id": "thread-1", "user_id": "user-1"},
            },
        )
    )
    handler.flush()

    last = result["messages"][-1]
    assert getattr(last, "content", "") == "pong from docs"
    assert len(calls) == 1
    trace = calls[0]["trace"]
    assert trace["name"] == "support-agent"
    assert trace["thread_id"] == "thread-1"
    types = {span["type"] for span in trace["spans"]}
    assert "generation" in types
    assert "tool" in types
    tool_names = {
        span.get("name") or span.get("tool_name")
        for span in trace["spans"]
        if span["type"] == "tool"
    }
    assert "ping" in tool_names


def test_langgraph_ainvoke_is_one_root():
    calls = []
    handler = langgraph(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
        transport=make_transport(calls),
        agent_name="support-graph",
    )
    model = ScriptedChatModel(responses=[AIMessage(content="graph hello")])

    async def call_model(state: MessagesState) -> dict[str, Any]:
        return {"messages": [await model.ainvoke(state["messages"])]}

    graph = (
        StateGraph(MessagesState)
        .add_node("agent", call_model)
        .add_edge(START, "agent")
        .add_edge("agent", END)
        .compile()
    )

    result = asyncio.run(
        graph.ainvoke(
            {"messages": [{"role": "user", "content": "hi"}]},
            {
                "callbacks": [handler],
                "metadata": {"thread_id": "thread-9"},
            },
        )
    )
    handler.flush()

    assert result["messages"][-1].content == "graph hello"
    assert len(calls) == 1
    trace = calls[0]["trace"]
    assert trace["name"] == "support-graph"
    assert trace["thread_id"] == "thread-9"
    assert any(span["type"] == "generation" for span in trace["spans"])
