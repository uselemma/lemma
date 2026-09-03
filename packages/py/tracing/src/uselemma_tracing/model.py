"""Pick a canonical model identity string from provider / framework payloads.

Looks at invocation, response, and ``response_metadata`` aliases. Does not
invent a name when none is present. Bare strings (completions, messages) are
never treated as a model id — only named model fields on objects.
"""

from __future__ import annotations

from typing import Any

_MODEL_KEYS = (
    "model",
    "model_name",
    "modelName",
    "model_id",
    "modelId",
    "ls_model_name",
)

_NESTED_CONTAINERS = (
    "response_metadata",
    "responseMetadata",
    "llm_output",
    "llmOutput",
    "generationInfo",
    "generation_info",
    "kwargs",
    "additional_kwargs",
    "message",
    "response",
)

_SKIP_TYPES = (bool, int, float, str, list, tuple, bytes)


def _as_non_empty_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _get_key(raw: Any, key: str) -> Any:
    if isinstance(raw, dict):
        return raw.get(key)
    return getattr(raw, key, None)


def pick_model_identity(raw: Any) -> str | None:
    """Extract a model id from an invocation dict, response, or wrapper.

    Recurses only into known nested objects (``response_metadata``,
    ``kwargs``, ``message``, …). A bare string is never a model id.
    """
    if raw is None or isinstance(raw, _SKIP_TYPES):
        return None

    for key in _MODEL_KEYS:
        value = _get_key(raw, key)
        as_string = _as_non_empty_string(value)
        if as_string:
            return as_string
        if value is not None and not isinstance(value, _SKIP_TYPES):
            nested = pick_model_identity(value)
            if nested:
                return nested

    for key in _NESTED_CONTAINERS:
        nested = pick_model_identity(_get_key(raw, key))
        if nested:
            return nested

    return None


def pick_generation_model_identity(raw: Any) -> str | None:
    """Walk an LLMResult-shaped payload for a model id."""
    direct = pick_model_identity(raw)
    if direct:
        return direct

    generations = _get_key(raw, "generations")
    if not isinstance(generations, list):
        return None

    for group in generations:
        if not isinstance(group, list):
            from_group = pick_model_identity(group)
            if from_group:
                return from_group
            continue
        for item in group:
            from_item = pick_model_identity(item)
            if from_item:
                return from_item

    return None
