from __future__ import annotations

import json
import os
import asyncio
import sys
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from .env import load_example_env
from .prompt import AGENT_NAME

T = TypeVar("T")

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


def lemma_example_metadata(identity: TurnIdentity) -> dict[str, str]:
    metadata = {"thread_id": identity.thread_id}
    if identity.user_id:
        metadata["user_id"] = identity.user_id
    return metadata


def langchain_messages_from_turn(
    turn: ChatTurn,
    to_message: Callable[[str, str], T],
) -> list[T]:
    return [
        *[to_message(item["role"], item["content"]) for item in turn.history],
        to_message("user", turn.message),
    ]


def last_message_text(messages: list[Any] | None) -> str:
    last = messages[-1] if messages else None
    content = getattr(last, "content", "")
    return content if isinstance(content, str) else json.dumps(content)


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
