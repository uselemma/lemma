from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from lemma_examples_shared import (
    AGENT_NAME,
    LIST_DOCS_DESCRIPTION,
    MODEL,
    READ_DOC_DESCRIPTION,
    SYSTEM_PROMPT,
    ChatTurn,
    list_docs,
    load_example_env,
    read_doc,
    require_openai_key,
    run_cli,
)
from uselemma_tracing import langgraph

load_example_env()
require_openai_key()

tools = [
    StructuredTool.from_function(
        name="list_docs",
        description=LIST_DOCS_DESCRIPTION,
        func=list_docs,
    ),
    StructuredTool.from_function(
        name="read_doc",
        description=READ_DOC_DESCRIPTION,
        func=read_doc,
    ),
]
model = ChatOpenAI(model=MODEL).bind_tools(tools)
tool_node = ToolNode(tools)


async def call_model(state: MessagesState) -> dict[str, Any]:
    response = await model.ainvoke(
        [SystemMessage(SYSTEM_PROMPT), *state["messages"]]
    )
    return {"messages": [response]}


def should_continue(state: MessagesState) -> Literal["tools", "__end__"]:
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and last.tool_calls:
        return "tools"
    return END


graph = (
    StateGraph(MessagesState)
    .add_node("agent", call_model)
    .add_node("tools", tool_node)
    .add_edge(START, "agent")
    .add_conditional_edges("agent", should_continue)
    .add_edge("tools", "agent")
    .compile()
)

lemma_handler = langgraph(agent_name=AGENT_NAME)


async def run_turn(turn: ChatTurn) -> str:
    result = await graph.ainvoke(
        {
            "messages": [
                *[
                    HumanMessage(item["content"])
                    if item["role"] == "user"
                    else AIMessage(item["content"])
                    for item in turn.history
                ],
                HumanMessage(turn.message),
            ]
        },
        {
            "callbacks": [lemma_handler],
            "metadata": {
                "thread_id": turn.identity.thread_id,
                **({"user_id": turn.identity.user_id} if turn.identity.user_id else {}),
            },
        },
    )
    lemma_handler.flush()
    last = result["messages"][-1]
    content = getattr(last, "content", "")
    return content if isinstance(content, str) else json.dumps(content)


if __name__ == "__main__":
    asyncio.run(run_cli(run_turn))
