from __future__ import annotations

import asyncio

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
    langchain_messages_from_turn,
    last_message_text,
    lemma_example_metadata,
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
        coroutine=list_docs,
    ),
    StructuredTool.from_function(
        name="read_doc",
        description=READ_DOC_DESCRIPTION,
        coroutine=read_doc,
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
