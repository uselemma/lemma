from __future__ import annotations

import asyncio

from agents import Agent, Runner, function_tool, trace
from lemma_examples_shared import (
    AGENT_NAME,
    LIST_DOCS_DESCRIPTION,
    MODEL,
    READ_DOC_DESCRIPTION,
    SYSTEM_PROMPT,
    ChatTurn,
    list_docs,
    load_example_env,
    model_messages,
    read_doc,
    require_openai_key,
    run_cli,
)
from uselemma_tracing import instrument_openai_agents

load_example_env()
require_openai_key()

processor = instrument_openai_agents()


@function_tool(name_override="list_docs", description_override=LIST_DOCS_DESCRIPTION)
def list_docs_tool() -> str:
    return list_docs()


@function_tool(name_override="read_doc", description_override=READ_DOC_DESCRIPTION)
def read_doc_tool(url: str) -> str:
    return read_doc(url)


agent = Agent(
    name=AGENT_NAME,
    instructions=SYSTEM_PROMPT,
    model=MODEL,
    tools=[list_docs_tool, read_doc_tool],
)


async def run_turn(turn: ChatTurn) -> str:
    metadata = {"user_id": turn.identity.user_id} if turn.identity.user_id else {}
    with trace(AGENT_NAME, group_id=turn.identity.thread_id, metadata=metadata):
        result = await Runner.run(agent, model_messages(turn))
    processor.force_flush()
    return str(result.final_output or "")


if __name__ == "__main__":
    asyncio.run(run_cli(run_turn))
