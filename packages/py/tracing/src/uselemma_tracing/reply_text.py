"""Display text from chat and Responses content blocks.

Reasoning and encrypted reasoning are not part of the reply.
"""

from __future__ import annotations

from typing import Any


def is_reply_reasoning(record: dict[str, Any]) -> bool:
    return record.get("type") == "reasoning" or isinstance(
        record.get("encrypted_content"), str
    )


def read_content_reply(content: Any) -> tuple[list[str], bool] | None:
    """Return reply text parts and whether a known block was present.

    ``None`` when ``content`` is not a list. An empty part list with
    ``recognized=True`` means the list was only reasoning.
    """
    if not isinstance(content, list):
        return None
    parts: list[str] = []
    recognized = False
    for block in content:
        if not isinstance(block, dict):
            continue
        if is_reply_reasoning(block):
            recognized = True
            continue
        if block.get("type") in {"text", "output_text"} and isinstance(
            block.get("text"), str
        ):
            parts.append(block["text"])
            recognized = True
    return parts, recognized
