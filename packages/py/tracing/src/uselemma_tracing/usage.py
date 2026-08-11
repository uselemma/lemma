"""Normalize provider token-usage shapes into the Lemma wire format.

Wire format (snake_case)::

    {
      "input_tokens": int,
      "output_tokens": int,
      "cache_read_input_tokens": int,
      "cache_creation_input_tokens": int,
      "reasoning_output_tokens": int,
    }

Omit fields the provider did not supply; never invent zeros. Explicit zeros
are emitted so Analytics can distinguish healthy zero from missing
instrumentation. ``total_tokens`` / ``totalTokens`` alone is not enough —
do not invent an input/output split.
"""

from __future__ import annotations

from typing import Any


def _as_finite_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value == value:  # not NaN
        return value
    return None


def _pick_number(source: dict[str, Any], keys: tuple[str, ...]) -> int | float | None:
    for key in keys:
        value = _as_finite_number(source.get(key))
        if value is not None:
            return value
    return None


def _as_dict(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    return None


def normalize_token_usage(raw: Any) -> dict[str, int | float] | None:
    """Normalize provider-specific usage into snake_case TokenUsage.

    Accepts camelCase / snake_case / prompt+completion aliases, OpenAI nested
    details, Anthropic cache fields, Vercel AI SDK, LangChain tokenUsage /
    usage_metadata, and Mastra when input/output are distinguishable.
    """
    if raw is None:
        return None

    source = _as_dict(raw)
    if source is None:
        return None

    nested = (
        _as_dict(source.get("tokenUsage"))
        or _as_dict(source.get("token_usage"))
        or _as_dict(source.get("usage_metadata"))
        or _as_dict(source.get("usage"))
    )
    if nested is not None:
        outer_has_tokens = (
            _pick_number(
                source,
                (
                    "inputTokens",
                    "input_tokens",
                    "promptTokens",
                    "prompt_tokens",
                    "outputTokens",
                    "output_tokens",
                    "completionTokens",
                    "completion_tokens",
                ),
            )
            is not None
        )
        if not outer_has_tokens:
            source = nested

    input_tokens = _pick_number(
        source,
        ("inputTokens", "input_tokens", "promptTokens", "prompt_tokens"),
    )
    output_tokens = _pick_number(
        source,
        (
            "outputTokens",
            "output_tokens",
            "completionTokens",
            "completion_tokens",
        ),
    )

    prompt_details = (
        _as_dict(source.get("prompt_tokens_details"))
        or _as_dict(source.get("promptTokensDetails"))
        or _as_dict(source.get("input_token_details"))
        or _as_dict(source.get("inputTokenDetails"))
    )
    completion_details = (
        _as_dict(source.get("completion_tokens_details"))
        or _as_dict(source.get("completionTokensDetails"))
        or _as_dict(source.get("output_token_details"))
        or _as_dict(source.get("outputTokenDetails"))
    )

    cache_read = _pick_number(
        source,
        (
            "cacheReadInputTokens",
            "cache_read_input_tokens",
            "cachedInputTokens",
            "cached_input_tokens",
            "cache_read",
        ),
    )
    if cache_read is None and prompt_details is not None:
        cache_read = _pick_number(
            prompt_details,
            ("cached_tokens", "cachedTokens", "cache_read", "cacheRead"),
        )

    cache_creation = _pick_number(
        source,
        (
            "cacheCreationInputTokens",
            "cache_creation_input_tokens",
            "cache_creation",
        ),
    )
    if cache_creation is None and prompt_details is not None:
        cache_creation = _pick_number(
            prompt_details,
            ("cache_creation", "cacheCreation", "cache_write", "cacheWrite"),
        )

    reasoning = _pick_number(
        source,
        (
            "reasoningOutputTokens",
            "reasoning_output_tokens",
            "reasoningTokens",
            "reasoning_tokens",
        ),
    )
    if reasoning is None and completion_details is not None:
        reasoning = _pick_number(
            completion_details,
            ("reasoning_tokens", "reasoningTokens", "reasoning"),
        )

    usage: dict[str, int | float] = {}
    if input_tokens is not None:
        usage["input_tokens"] = input_tokens
    if output_tokens is not None:
        usage["output_tokens"] = output_tokens
    if cache_read is not None:
        usage["cache_read_input_tokens"] = cache_read
    if cache_creation is not None:
        usage["cache_creation_input_tokens"] = cache_creation
    if reasoning is not None:
        usage["reasoning_output_tokens"] = reasoning

    return usage or None


def token_usage_attributes(usage: dict[str, int | float] | None) -> dict[str, int | float]:
    """Flatten usage into GenAI + OpenInference attribute keys."""
    if not usage:
        return {}
    attrs: dict[str, int | float] = {}
    if "input_tokens" in usage:
        attrs["gen_ai.usage.input_tokens"] = usage["input_tokens"]
        attrs["llm.token_count.prompt"] = usage["input_tokens"]
    if "output_tokens" in usage:
        attrs["gen_ai.usage.output_tokens"] = usage["output_tokens"]
        attrs["llm.token_count.completion"] = usage["output_tokens"]
    if "cache_read_input_tokens" in usage:
        attrs["gen_ai.usage.cache_read.input_tokens"] = usage[
            "cache_read_input_tokens"
        ]
    if "cache_creation_input_tokens" in usage:
        attrs["gen_ai.usage.cache_creation.input_tokens"] = usage[
            "cache_creation_input_tokens"
        ]
    if "reasoning_output_tokens" in usage:
        attrs["gen_ai.usage.reasoning.output_tokens"] = usage[
            "reasoning_output_tokens"
        ]
    return attrs
