from __future__ import annotations

import asyncio
import json
import time
from typing import Any, cast

from lemma_examples_shared import (
    AGENT_NAME,
    LIST_DOCS_DESCRIPTION,
    MODEL,
    READ_DOC_DESCRIPTION,
    SYSTEM_PROMPT,
    ChatTurn,
    execute_docs_tool,
    load_example_env,
    model_messages,
    require_openai_key,
    run_cli,
)
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam, ChatCompletionToolParam
from uselemma_tracing import Lemma

load_example_env()
lemma = Lemma()
openai = AsyncOpenAI(api_key=require_openai_key())

TOOLS: list[ChatCompletionToolParam] = [
    {
        "type": "function",
        "function": {
            "name": "list_docs",
            "description": LIST_DOCS_DESCRIPTION,
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_doc",
            "description": READ_DOC_DESCRIPTION,
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
]


async def run_turn(turn: ChatTurn) -> str:
    async def run(trace: Any) -> str:
        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            *cast(list[ChatCompletionMessageParam], model_messages(turn)),
        ]
        for _ in range(8):
            prompt = list(messages)
            started = time.perf_counter()
            completion = await openai.chat.completions.create(
                model=MODEL,
                messages=prompt,
                tools=TOOLS,
            )
            choice = completion.choices[0].message
            duration_ms = int((time.perf_counter() - started) * 1000)
            trace.record_generation(
                name="answer",
                model=MODEL,
                input=prompt,
                output=choice.content or [call.model_dump() for call in (choice.tool_calls or [])],
                duration_ms=duration_ms,
                llm_input_messages=prompt,
                llm_invocation_parameters={"model": MODEL},
                usage=(
                    {
                        "input_tokens": completion.usage.prompt_tokens,
                        "output_tokens": completion.usage.completion_tokens,
                    }
                    if completion.usage
                    else None
                ),
            )
            assistant_message: ChatCompletionMessageParam = {
                "role": "assistant",
                "content": choice.content,
            }
            if choice.tool_calls:
                assistant_message["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments or "{}",
                        },
                    }
                    for call in choice.tool_calls
                ]
            messages.append(assistant_message)
            if not choice.tool_calls:
                return choice.content or ""
            for call in choice.tool_calls:
                args = json.loads(call.function.arguments or "{}")
                tool_started = time.perf_counter()
                try:
                    output = execute_docs_tool(call.function.name, args)
                    trace.record_tool(
                        name=call.function.name,
                        input=args,
                        output=output,
                        duration_ms=int((time.perf_counter() - tool_started) * 1000),
                        tool_parameters=(
                            {"url": "string"} if call.function.name == "read_doc" else {}
                        ),
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": output,
                        }
                    )
                except Exception as error:
                    trace.record_tool(
                        name=call.function.name,
                        input=args,
                        error=error,
                        duration_ms=int((time.perf_counter() - tool_started) * 1000),
                    )
                    raise
        return "Stopped after the tool-call limit."

    return await lemma.async_trace(
        AGENT_NAME,
        run,
        input=turn.message,
        thread_id=turn.identity.thread_id,
        user_id=turn.identity.user_id,
    )


if __name__ == "__main__":
    asyncio.run(run_cli(run_turn))
