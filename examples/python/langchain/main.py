from __future__ import annotations

import asyncio
import json
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langchain_openai import ChatOpenAI
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
from uselemma_tracing import langchain

load_example_env()
require_openai_key()

list_docs_tool = StructuredTool.from_function(
    name="list_docs",
    description=LIST_DOCS_DESCRIPTION,
    func=list_docs,
)
read_doc_tool = StructuredTool.from_function(
    name="read_doc",
    description=READ_DOC_DESCRIPTION,
    func=read_doc,
)
tools = [list_docs_tool, read_doc_tool]
tool_by_name = {item.name: item for item in tools}

lemma_handler = langchain(
    agent_name=AGENT_NAME,
    thread_id_key="thread_id",
    user_id_key="user_id",
)
model = ChatOpenAI(model=MODEL).bind_tools(tools)


async def run_turn(turn: ChatTurn) -> str:
    config: dict[str, Any] = {
        "callbacks": [lemma_handler],
        "metadata": {
            "thread_id": turn.identity.thread_id,
            **({"user_id": turn.identity.user_id} if turn.identity.user_id else {}),
        },
    }
    messages: list[Any] = [
        SystemMessage(SYSTEM_PROMPT),
        *[
            HumanMessage(item["content"])
            if item["role"] == "user"
            else AIMessage(item["content"])
            for item in turn.history
        ],
        HumanMessage(turn.message),
    ]
    for _ in range(8):
        response = await model.ainvoke(messages, config=config)
        messages.append(response)
        tool_calls = getattr(response, "tool_calls", None) or []
        if not tool_calls:
            lemma_handler.flush()
            content = response.content
            return content if isinstance(content, str) else json.dumps(content)
        for call in tool_calls:
            selected = tool_by_name[call["name"]]
            output = await selected.ainvoke(call["args"], config=config)
            messages.append(
                ToolMessage(
                    content=output if isinstance(output, str) else json.dumps(output),
                    tool_call_id=call.get("id") or call["name"],
                )
            )
    lemma_handler.flush()
    return "Stopped after the tool-call limit."


if __name__ == "__main__":
    asyncio.run(run_cli(run_turn))
