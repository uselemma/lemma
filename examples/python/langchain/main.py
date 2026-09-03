from __future__ import annotations

import asyncio
import json

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage
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

agent = create_agent(
    model=ChatOpenAI(model=MODEL),
    tools=tools,
    system_prompt=SYSTEM_PROMPT,
)

lemma_handler = langchain(agent_name=AGENT_NAME)


async def run_turn(turn: ChatTurn) -> str:
    result = await agent.ainvoke(
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
