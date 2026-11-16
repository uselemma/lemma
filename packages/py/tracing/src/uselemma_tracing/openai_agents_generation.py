"""OpenAI Agents generation fields from one normalized response object."""

from __future__ import annotations

from typing import Any

from .usage import normalize_token_usage

_RESPONSE_SETTING_KEYS = (
    "temperature",
    "top_p",
    "max_output_tokens",
    "max_tool_calls",
    "tool_choice",
    "parallel_tool_calls",
    "truncation",
    "reasoning",
    "text",
    "service_tier",
)

_HISTORY_ITEM_ROLES = {
    "function_call": "assistant",
    "reasoning": "assistant",
    "function_call_result": "tool",
    "function_call_output": "tool",
}


def response_mapping(data: dict[str, Any]) -> dict[str, Any] | None:
    """The Responses object on span data, whether the SDK used response or _response."""
    response = data.get("response")
    if response is None:
        response = data.get("_response")
    if response is None:
        return None
    return as_response_dict(response)


def as_response_dict(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return dict(value)
    if value is None or isinstance(value, (str, int, float, bool, list, tuple)):
        return None
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            dumped = model_dump()
        except Exception:
            dumped = None
        if isinstance(dumped, dict):
            return dumped
    mapping: dict[str, Any] = {}
    for key in (
        "model",
        "instructions",
        "output",
        "output_text",
        "tools",
        "usage",
        *_RESPONSE_SETTING_KEYS,
    ):
        if hasattr(value, key):
            mapping[key] = getattr(value, key)
    return mapping or None


def _instructions_text(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def _is_same_system_message(message: Any, instructions: str) -> bool:
    return (
        isinstance(message, dict)
        and message.get("role") == "system"
        and message.get("content") == instructions
    )


def _with_history_role(message: Any) -> Any:
    if not isinstance(message, dict):
        return message
    if isinstance(message.get("role"), str) and message.get("role"):
        return message
    role = _HISTORY_ITEM_ROLES.get(message.get("type"))
    if role is None:
        return message
    return {**message, "role": role}


def _history_messages(messages: list[Any]) -> list[Any]:
    return [_with_history_role(message) for message in messages]


def _input_messages(input_value: Any, response: dict[str, Any] | None) -> list[Any] | None:
    instructions = _instructions_text(None if response is None else response.get("instructions"))
    messages = input_value if isinstance(input_value, list) else None
    if instructions is None:
        return None if messages is None else _history_messages(messages)
    if messages is not None and any(
        _is_same_system_message(message, instructions) for message in messages
    ):
        return _history_messages(messages)
    system = {"role": "system", "content": instructions}
    if messages is None:
        if isinstance(input_value, str) and input_value:
            return _history_messages([system, {"role": "user", "content": input_value}])
        return _history_messages([system])
    return _history_messages([system, *messages])


def _tools(data: dict[str, Any], response: dict[str, Any] | None) -> Any:
    if response is not None and response.get("tools") is not None:
        return response.get("tools")
    if data.get("tools") is not None:
        return data.get("tools")
    return None


def _invocation_parameters(data: dict[str, Any], response: dict[str, Any] | None) -> Any:
    if data.get("model_config") is not None:
        return data.get("model_config")
    if response is None:
        return None
    settings = {
        key: response.get(key)
        for key in _RESPONSE_SETTING_KEYS
        if response.get(key) is not None
    }
    return settings or None


def _output_messages(data: dict[str, Any], response: dict[str, Any] | None) -> list[Any] | None:
    span_type = data.get("type")
    if span_type not in {"generation", "response"}:
        return None
    if span_type == "generation" and isinstance(data.get("output"), list):
        return data.get("output")
    if response is not None and isinstance(response.get("output"), list):
        return response.get("output")
    output = data.get("output")
    if isinstance(output, list):
        return output
    return None


def _usage(data: dict[str, Any], response: dict[str, Any] | None) -> dict[str, int | float] | None:
    direct = normalize_token_usage(data.get("usage"))
    if direct is not None:
        return direct
    if response is None:
        return None
    return normalize_token_usage(response.get("usage"))


def generation_snapshot(data: dict[str, Any], input_value: Any) -> dict[str, Any]:
    """One read of the response object for messages, tools, settings, and usage."""
    response = response_mapping(data)
    fields: dict[str, Any] = {}
    messages = _input_messages(input_value, response)
    if messages is not None:
        fields["llm_input_messages"] = messages
    parameters = _invocation_parameters(data, response)
    if parameters is not None:
        fields["llm_invocation_parameters"] = parameters
    tools = _tools(data, response)
    if tools is not None:
        fields["llm_tools"] = tools
    return {
        "response": response,
        "fields": fields,
        "output_messages": _output_messages(data, response),
        "usage": _usage(data, response),
    }


def reply_from_response(
    data: dict[str, Any],
    response: dict[str, Any] | None,
    flatten,
) -> Any:
    """Reply text from the normalized response.

    A value that is not a mapping stays the span output, which is how
    non-object SDK payloads were recorded.
    """
    if response is None:
        raw = data.get("response")
        if raw is None:
            raw = data.get("_response")
        if raw is None:
            return flatten(data.get("output"))
        if isinstance(raw, (str, int, float, bool)):
            return raw
        return str(raw)
    if isinstance(response.get("output_text"), str):
        return response["output_text"]
    if isinstance(response.get("output"), list):
        return flatten(response["output"])
    return response
