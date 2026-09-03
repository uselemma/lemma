from __future__ import annotations

import asyncio
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
    langchain_messages_from_turn,
    last_message_text,
    lemma_example_metadata,
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
        coroutine=list_docs,
    ),
    StructuredTool.from_function(
        name="read_doc",
        description=READ_DOC_DESCRIPTION,
        coroutine=read_doc,
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
            "messages": langchain_messages_from_turn(
                turn,
                lambda role, content: (
                    HumanMessage(content) if role == "user" else AIMessage(content)
                ),
            )
        },
        {
            "callbacks": [lemma_handler],
            "metadata": lemma_example_metadata(turn.identity),
        },
    )
    lemma_handler.flush()
    return last_message_text(result["messages"])


if __name__ == "__main__":
    asyncio.run(run_cli(run_turn))
