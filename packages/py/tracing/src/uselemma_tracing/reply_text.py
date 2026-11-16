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


def _text_from_content_parts(content: Any) -> str | None:
    if isinstance(content, str):
        return content
    reply = read_content_reply(content)
    if reply is None or not reply[1]:
        return None
    return "".join(reply[0])


def generation_output(output: Any) -> Any:
    """Reply text for a generation or Responses output list."""
    if not isinstance(output, list):
        return output
    text = ""
    saw_unhandled = False
    for item in output:
        if not isinstance(item, dict):
            saw_unhandled = True
            continue
        if is_reply_reasoning(item):
            continue
        if isinstance(item.get("text"), str):
            text += item["text"]
            continue
        if isinstance(item.get("content"), str):
            text += item["content"]
            continue
        if isinstance(item.get("content"), list):
            from_parts = _text_from_content_parts(item.get("content"))
            if from_parts is not None:
                text += from_parts
                continue
        saw_unhandled = True
    if text:
        return text
    # Reasoning-only output must not fall back to the raw item array.
    if not saw_unhandled and output:
        return ""
    return output
