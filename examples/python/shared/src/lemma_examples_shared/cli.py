from __future__ import annotations

import os
import asyncio
import sys
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from .env import load_example_env
from .prompt import AGENT_NAME

ChatMessage = dict[str, str]


@dataclass(frozen=True)
class TurnIdentity:
    thread_id: str
    user_id: str | None = None


@dataclass(frozen=True)
class ChatTurn:
    message: str
    history: list[ChatMessage]
    identity: TurnIdentity


RunTurn = Callable[[ChatTurn], Awaitable[str]]


def model_messages(turn: ChatTurn) -> list[ChatMessage]:
    return [*turn.history, {"role": "user", "content": turn.message}]


async def run_cli(run_turn: RunTurn) -> None:
    load_example_env()
    identity = TurnIdentity(
        thread_id=str(uuid.uuid4()),
        user_id=os.environ.get("LEMMA_USER_ID") or None,
    )
    history: list[ChatMessage] = []

    async def ask(message: str) -> str:
        answer = await run_turn(
            ChatTurn(message=message, history=list(history), identity=identity)
        )
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": answer})
        return answer

    one_shot = " ".join(sys.argv[1:]).strip()
    if one_shot:
        print(await ask(one_shot))
        return

    print(f"{AGENT_NAME}  thread={identity.thread_id}")
    print("Ask a question about Lemma. Empty line or Ctrl+D to exit.\n")
    loop = asyncio.get_running_loop()
    while True:
        try:
            line = await loop.run_in_executor(None, lambda: input("> "))
        except EOFError:
            break
        message = line.strip()
        if not message:
            break
        answer = await ask(message)
        print(f"\n{answer}\n")
