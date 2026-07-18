from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .client import Lemma, SpanHandle, TraceContext, _duration_ms, _now
from .tool_result import tool_result_error

KNOWN_PROVIDERS = (
    "openai",
    "anthropic",
    "azure",
    "azure_openai",
    "google",
    "google_genai",
    "google_vertexai",
    "vertexai",
    "bedrock",
    "amazon_bedrock",
    "cohere",
    "mistral",
    "mistralai",
    "groq",
    "fireworks",
    "together",
    "ollama",
    "huggingface",
    "huggingface_hub",
    "deepseek",
    "xai",
    "perplexity",
)

CLASS_PROVIDER_HINTS: list[tuple[str, str]] = [
    ("openai", "openai"),
    ("anthropic", "anthropic"),
    ("claude", "anthropic"),
    ("azure", "azure"),
    ("vertex", "google"),
    ("google", "google"),
    ("gemini", "google"),
    ("bedrock", "bedrock"),
    ("amazon", "bedrock"),
    ("cohere", "cohere"),
    ("mistral", "mistral"),
    ("groq", "groq"),
    ("fireworks", "fireworks"),
    ("together", "together"),
    ("ollama", "ollama"),
    ("huggingface", "huggingface"),
    ("deepseek", "deepseek"),
    ("xai", "xai"),
    ("grok", "xai"),
    ("perplexity", "perplexity"),
]


@dataclass
class _StoredRun:
    owning_trace_id: str
    root_run_id: str
    kind: str
    started_at: datetime
    owns_trace: bool
    parent_run_id: str | None = None
    handle: SpanHandle | None = None


@dataclass
class _StoredTrace:
    context: TraceContext
    opened_at: datetime
    ended: bool = False
    root_input: Any = None
    root_output: Any = None
    root_error: str | None = None
    earliest_start: datetime | None = None
    latest_end: datetime | None = None
    has_root_input: bool = False


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _serialized_name(serialized: Any, fallback: str) -> str:
    name = _get(serialized, "name")
    if isinstance(name, str) and name:
        return name
    ids = _get(serialized, "id")
    if isinstance(ids, list) and ids:
        return str(ids[-1])
    return fallback


def _model_name(serialized: Any, extra_params: dict[str, Any] | None = None) -> str | None:
    kwargs = _get(serialized, "kwargs", {}) or {}
    for source in (kwargs, serialized, extra_params or {}):
        if not isinstance(source, dict) and source is not serialized:
            continue
        for key in ("model", "model_name", "modelName", "model_id", "modelId"):
            value = _get(source, key)
            if isinstance(value, str) and value:
                return value
    return None


def _lookup_string(
    sources: list[dict[str, Any] | None],
    keys: list[str],
) -> str | None:
    for source in sources:
        if not source:
            continue
        for key in keys:
            value = source.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def _tag_value(tags: list[str] | None, keys: list[str]) -> str | None:
    if not tags:
        return None
    for key in keys:
        prefixes = (f"{key}:", f"{key}=")
        for tag in tags:
            if not isinstance(tag, str):
                continue
            for prefix in prefixes:
                if tag.startswith(prefix):
                    value = tag[len(prefix) :].strip()
                    if value:
                        return value
    return None


def _message_content(message: Any) -> Any:
    if not isinstance(message, dict) and not hasattr(message, "content"):
        return message
    content = _get(message, "content")
    if content is not None or (isinstance(message, dict) and "content" in message):
        return content
    return message


def _role_from_class_name(name: str) -> str | None:
    lower = name.lower()
    if "human" in lower or lower == "user":
        return "user"
    if "ai" in lower or "assistant" in lower:
        return "assistant"
    if "system" in lower:
        return "system"
    if "tool" in lower:
        return "tool"
    if "function" in lower:
        return "function"
    return None


def _message_role(message: Any) -> str | None:
    role = _get(message, "role")
    if isinstance(role, str) and role:
        return role

    type_value = _get(message, "type") or _get(message, "_type")
    get_type = getattr(message, "get_type", None) or getattr(message, "getType", None)
    if callable(get_type):
        try:
            type_value = type_value or get_type()
        except Exception:
            pass

    if isinstance(type_value, str):
        mapping = {
            "human": "user",
            "user": "user",
            "ai": "assistant",
            "assistant": "assistant",
            "system": "system",
            "tool": "tool",
            "function": "function",
            "developer": "developer",
        }
        if type_value in mapping:
            return mapping[type_value]
        return _role_from_class_name(type_value) or type_value

    ids = _get(message, "id")
    if isinstance(ids, list) and ids:
        return _role_from_class_name(str(ids[-1]))

    class_name = type(message).__name__ if not isinstance(message, dict) else None
    if class_name:
        return _role_from_class_name(class_name)
    return None


def _tool_calls_from_message(message: Any) -> list[Any] | None:
    for key in ("tool_calls", "toolCalls"):
        value = _get(message, key)
        if isinstance(value, list) and value:
            return value
    additional = _get(message, "additional_kwargs") or {}
    if isinstance(additional, dict):
        calls = additional.get("tool_calls")
        if isinstance(calls, list) and calls:
            return calls
    kwargs = _get(message, "kwargs") or {}
    if isinstance(kwargs, dict):
        calls = kwargs.get("tool_calls")
        if isinstance(calls, list) and calls:
            return calls
    return None


def normalize_message(message: Any) -> dict[str, Any]:
    """Normalize LangChain message classes / dicts to ``{role, content, ...}``."""
    if isinstance(message, str):
        return {"role": "user", "content": message}

    kwargs = _get(message, "kwargs") if not isinstance(message, str) else None
    kwargs = kwargs if isinstance(kwargs, dict) else None

    if isinstance(message, dict) and "content" in message:
        content = message["content"]
    elif kwargs and "content" in kwargs:
        content = kwargs["content"]
    else:
        content = _message_content(message)

    role = _message_role(message) or (kwargs and _message_role(kwargs)) or "user"
    normalized: dict[str, Any] = {"role": role, "content": content}

    tool_calls = _tool_calls_from_message(message)
    if tool_calls is None and kwargs is not None:
        tool_calls = _tool_calls_from_message(kwargs)
    if tool_calls is not None:
        normalized["tool_calls"] = tool_calls

    tool_call_id = (
        _get(message, "tool_call_id")
        or _get(message, "toolCallId")
        or (kwargs.get("tool_call_id") if kwargs else None)
    )
    if isinstance(tool_call_id, str) and tool_call_id:
        normalized["tool_call_id"] = tool_call_id

    name = _get(message, "name") or (kwargs.get("name") if kwargs else None)
    if isinstance(name, str) and name and role in {"tool", "function"}:
        normalized["name"] = name

    return normalized


def normalize_messages(messages: list[Any]) -> list[dict[str, Any]]:
    return [normalize_message(message) for message in messages]


def _as_message_list(input_value: Any) -> list[Any] | None:
    if isinstance(input_value, list):
        return input_value
    if isinstance(input_value, dict):
        messages = input_value.get("messages")
        if isinstance(messages, list):
            return messages
        nested = input_value.get("input")
        if isinstance(nested, list):
            return nested
    return None


def root_trace_input(input_value: Any) -> Any:
    """Prefer the current user turn for the Lemma root input."""
    if isinstance(input_value, str):
        return input_value

    messages = _as_message_list(input_value)
    if messages:
        for message in reversed(messages):
            normalized = normalize_message(message)
            if normalized["role"] == "user":
                return normalized["content"]
        return normalize_message(messages[-1])["content"]

    if isinstance(input_value, dict):
        for key in (
            "input",
            "question",
            "query",
            "prompt",
            "text",
            "user_input",
            "userInput",
        ):
            value = input_value.get(key)
            if isinstance(value, str) and value:
                return value

    return input_value


def _structured_assistant_output(message: dict[str, Any]) -> Any:
    if message.get("tool_calls") is not None:
        return {
            "role": "assistant",
            "content": message.get("content"),
            "tool_calls": message["tool_calls"],
        }
    return message.get("content")


def root_trace_output(output: Any) -> Any:
    if output is None or isinstance(output, str):
        return output

    if isinstance(output, dict):
        if output.get("role") == "assistant" and (
            output.get("tool_calls") is not None or output.get("toolCalls") is not None
        ):
            return output

    messages = _as_message_list(output)
    if messages:
        for message in reversed(messages):
            normalized = normalize_message(message)
            if normalized["role"] == "assistant":
                return _structured_assistant_output(normalized)
        return _structured_assistant_output(normalize_message(messages[-1]))

    if isinstance(output, dict):
        for key in ("output", "answer", "result", "text", "content"):
            value = output.get(key)
            if isinstance(value, str) and value:
                return value
            if isinstance(value, dict) and isinstance(value.get("content"), str):
                return value["content"]

    return output


def _first_text(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if isinstance(value.get("text"), str):
            return value["text"]
        if isinstance(value.get("content"), str):
            return value["content"]
        return _first_text(value.get("message"))
    text = getattr(value, "text", None)
    if isinstance(text, str):
        return text
    content = getattr(value, "content", None)
    if isinstance(content, str):
        return content
    message = getattr(value, "message", None)
    if message is not None:
        return _first_text(message)
    return None


def _generation_message(item: Any) -> Any | None:
    if item is None:
        return None
    message = _get(item, "message")
    if message is not None:
        return message
    role = _get(item, "role")
    type_value = _get(item, "type") or _get(item, "_type")
    if isinstance(role, str) or isinstance(type_value, str):
        return item
    if isinstance(item, dict) and "content" in item and not isinstance(item.get("text"), str):
        return item
    return None


def llm_structured_output(response: Any) -> Any:
    generations = _get(response, "generations")
    if not isinstance(generations, list):
        return response

    messages: list[dict[str, Any]] = []
    for group in generations:
        if not isinstance(group, list):
            continue
        for item in group:
            message = _generation_message(item)
            if message is not None:
                messages.append(normalize_message(message))
                continue
            text = _first_text(item)
            if text is not None:
                messages.append({"role": "assistant", "content": text})

    if len(messages) == 1:
        return _structured_assistant_output(messages[0])
    if len(messages) > 1:
        return messages

    text = "".join(
        text
        for group in generations
        if isinstance(group, list)
        for item in group
        if (text := _first_text(item))
    )
    return text or generations


def llm_output_messages(response: Any) -> list[Any] | None:
    generations = _get(response, "generations")
    if not isinstance(generations, list):
        return None
    messages: list[Any] = []
    for group in generations:
        if not isinstance(group, list):
            continue
        for item in group:
            message = _generation_message(item)
            if message is not None:
                messages.append(normalize_message(message))
                continue
            text = _first_text(item)
            if text is not None:
                messages.append({"role": "assistant", "content": text})
    return messages or None


def _provider_from_class_name(name: str) -> str | None:
    lower = name.lower()
    for needle, provider in CLASS_PROVIDER_HINTS:
        if needle in lower:
            return provider
    return None


def _normalize_provider(provider: str) -> str:
    mapping = {
        "azure_openai": "azure",
        "google_genai": "google",
        "google_vertexai": "google",
        "amazon_bedrock": "bedrock",
        "mistralai": "mistral",
        "huggingface_hub": "huggingface",
    }
    return mapping.get(provider, provider)


def _provider_from_id(ids: Any) -> str | None:
    if not isinstance(ids, list):
        return None
    for part in ids:
        if not isinstance(part, str):
            continue
        lower = part.lower().replace("-", "_")
        for provider in KNOWN_PROVIDERS:
            if lower == provider or provider in lower:
                return _normalize_provider(provider)
        if lower.startswith("langchain_") or lower.startswith("langchain"):
            rest = lower.split("_", 1)[-1] if "_" in lower else ""
            if rest and rest not in {"core", "community"}:
                return _provider_from_class_name(rest) or rest
    return None


def llm_provider(
    serialized: Any, extra_params: dict[str, Any] | None = None
) -> str | None:
    kwargs = _get(serialized, "kwargs", {}) or {}
    for source in (kwargs, serialized if isinstance(serialized, dict) else None, extra_params):
        if not source:
            continue
        for key in ("provider", "ls_provider", "llm_provider", "llmProvider"):
            value = source.get(key) if isinstance(source, dict) else _get(source, key)
            if isinstance(value, str) and value and value != "langchain":
                return value

    from_id = _provider_from_id(_get(serialized, "id"))
    if from_id:
        return from_id

    class_name = _serialized_name(serialized, "")
    if class_name:
        from_class = _provider_from_class_name(class_name)
        if from_class:
            return from_class

    type_value = None
    if extra_params:
        type_value = extra_params.get("_type")
    if type_value is None and isinstance(kwargs, dict):
        type_value = kwargs.get("_type")
    if isinstance(type_value, str):
        return _provider_from_class_name(type_value)
    return None


def _error_message(error: Any) -> str:
    return str(error)


def _langchain_attributes(
    run_id: str, parent_run_id: str | None, run_type: str
) -> dict[str, Any]:
    attrs: dict[str, Any] = {
        "langchain.run_id": str(run_id),
        "langchain.run_type": run_type,
    }
    if parent_run_id is not None:
        attrs["langchain.parent_run_id"] = str(parent_run_id)
    return attrs


class LemmaLangChainCallbackHandler:
    """LangChain callback handler that owns one Lemma trace per root run."""

    name = "lemma"

    def __init__(
        self,
        lemma: Lemma | None = None,
        *,
        api_key: str | None = None,
        project_id: str | None = None,
        base_url: str = "https://api.uselemma.ai",
        transport: Any = None,
        agent_name: str | None = None,
        metadata: dict[str, Any] | None = None,
        record_inputs: bool = True,
        record_outputs: bool = True,
        thread_id_key: str = "thread_id",
        user_id_key: str | None = None,
    ) -> None:
        self.lemma = lemma or Lemma(
            api_key=api_key,
            project_id=project_id,
            base_url=base_url,
            transport=transport,
        )
        self.agent_name = agent_name
        self.metadata = metadata or {}
        self.record_inputs = record_inputs
        self.record_outputs = record_outputs
        self.thread_id_key = thread_id_key
        self.user_id_key = user_id_key
        self._runs: dict[str, _StoredRun] = {}
        self._traces: dict[str, _StoredTrace] = {}

    def _trace_name(self, serialized: Any, fallback: str) -> str:
        return self.agent_name or _serialized_name(serialized, fallback)

    def _resolve_thread_id(
        self,
        metadata: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ) -> str | None:
        keys = [
            self.thread_id_key,
            "thread_id",
            "threadId",
            "conversation_id",
            "session_id",
        ]
        return _lookup_string([metadata, self.metadata], keys) or _tag_value(tags, keys)

    def _resolve_user_id(
        self,
        metadata: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ) -> str | None:
        if self.user_id_key:
            return _lookup_string(
                [metadata, self.metadata], [self.user_id_key]
            ) or _tag_value(tags, [self.user_id_key])
        keys = ["user_id", "userId", "resourceId"]
        return _lookup_string([metadata, self.metadata], keys) or _tag_value(tags, keys)

    def _apply_identity(
        self,
        stored: _StoredTrace,
        metadata: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ) -> None:
        thread_id = self._resolve_thread_id(metadata, tags)
        user_id = self._resolve_user_id(metadata, tags)
        if thread_id:
            stored.context.thread_id = thread_id
        if user_id:
            stored.context.user_id = user_id

    def _note_bounds(
        self,
        stored: _StoredTrace,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> None:
        if start is not None and (
            stored.earliest_start is None or start < stored.earliest_start
        ):
            stored.earliest_start = start
        if end is not None and (stored.latest_end is None or end > stored.latest_end):
            stored.latest_end = end

    def _note_root_input(self, stored: _StoredTrace, input_value: Any) -> None:
        if not self.record_inputs or input_value is None or stored.has_root_input:
            return
        stored.root_input = root_trace_input(input_value)
        stored.has_root_input = True
        stored.context.input = stored.root_input

    def _note_root_output(self, stored: _StoredTrace, output: Any) -> None:
        if not self.record_outputs or output is None or stored.root_error:
            return
        stored.root_output = root_trace_output(output)

    def _note_root_error(self, stored: _StoredTrace, error: str | None) -> None:
        if not error or stored.root_error:
            return
        stored.root_error = error

    def _create_owned_trace(
        self,
        run_id: str,
        name: str,
        input_value: Any,
        kind: str,
        metadata: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ) -> tuple[_StoredTrace, _StoredRun]:
        started_at = _now()
        context = TraceContext(
            name=name,
            input=root_trace_input(input_value) if self.record_inputs else None,
            metadata={
                **self.metadata,
                **(metadata or {}),
                "langchain_run_id": str(run_id),
            },
            thread_id=self._resolve_thread_id(metadata, tags),
            user_id=self._resolve_user_id(metadata, tags),
        )
        stored = _StoredTrace(
            context=context,
            opened_at=started_at,
            earliest_start=started_at,
            has_root_input=self.record_inputs and input_value is not None,
            root_input=root_trace_input(input_value) if self.record_inputs else None,
        )
        self._traces[str(run_id)] = stored
        run = _StoredRun(
            owning_trace_id=str(run_id),
            root_run_id=str(run_id),
            kind=kind,
            started_at=started_at,
            owns_trace=True,
        )
        self._runs[str(run_id)] = run
        return stored, run

    def _parent_run(self, parent_run_id: str | None) -> _StoredRun | None:
        if parent_run_id is None:
            return None
        return self._runs.get(str(parent_run_id))

    def _resolve_attachment(
        self,
        run_id: str,
        parent_run_id: str | None,
        create_root: Any,
    ) -> tuple[_StoredTrace, str | None, bool, str, str]:
        parent = self._parent_run(parent_run_id)
        if parent is None:
            stored, _run = create_root()
            return stored, None, True, str(run_id), str(run_id)

        stored = self._traces.get(parent.owning_trace_id)
        if stored is None or stored.ended:
            stored, _run = create_root()
            return stored, None, True, str(run_id), str(run_id)

        parent_id = parent.handle.id if parent.handle is not None else None
        return stored, parent_id, False, parent.owning_trace_id, parent.root_run_id

    def _forget_trace_runs(self, owning_trace_id: str) -> None:
        for run_id, run in list(self._runs.items()):
            if run.owning_trace_id == owning_trace_id:
                self._runs.pop(run_id, None)

    def _finalize(self, owning_trace_id: str, stored: _StoredTrace) -> None:
        self._traces.pop(owning_trace_id, None)
        self._forget_trace_runs(owning_trace_id)
        if stored.ended:
            return
        stored.ended = True

        ended_at = stored.latest_end or _now()
        started_at = stored.earliest_start or stored.opened_at or ended_at
        duration = _duration_ms(started_at, ended_at)
        if duration is not None:
            stored.context.duration_ms = duration

        if stored.root_error:
            stored.context.fail(
                "error" if not self.record_outputs else stored.root_error
            )
            self.lemma._send(stored.context, started_at, ended_at)
            return

        if self.record_outputs and stored.root_output is not None:
            stored.context.output(stored.root_output)

        self.lemma._send(stored.context, started_at, ended_at)

    def _maybe_finalize_owner(self, run: _StoredRun, ended_at: datetime) -> None:
        if not run.owns_trace:
            return
        stored = self._traces.get(run.owning_trace_id)
        if stored is None:
            return
        self._note_bounds(stored, run.started_at, ended_at)
        self._finalize(run.owning_trace_id, stored)

    def on_chain_start(
        self,
        serialized: Any,
        inputs: Any,
        *,
        run_id: str,
        parent_run_id: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        run_type: str | None = None,
        name: str | None = None,
        **_: Any,
    ) -> None:
        started_at = _now()
        chain_name = name or _serialized_name(serialized, "langchain-chain")
        parent = self._parent_run(parent_run_id)

        if parent is None:
            trace_serialized = dict(serialized or {}) if isinstance(serialized, dict) else {}
            if name:
                trace_serialized["name"] = name
            self._create_owned_trace(
                str(run_id),
                self._trace_name(trace_serialized or serialized, "langchain-run"),
                inputs,
                "chain",
                metadata,
                tags,
            )
            return

        stored = self._traces.get(parent.owning_trace_id)
        if stored is None or stored.ended:
            trace_serialized = dict(serialized or {}) if isinstance(serialized, dict) else {}
            if name:
                trace_serialized["name"] = name
            self._create_owned_trace(
                str(run_id),
                self._trace_name(trace_serialized or serialized, "langchain-run"),
                inputs,
                "chain",
                metadata,
                tags,
            )
            return

        self._apply_identity(stored, metadata, tags)
        self._note_bounds(stored, started_at, None)
        handle = stored.context.start_span(
            name=chain_name,
            parent_id=parent.handle.id if parent.handle is not None else None,
            input=inputs if self.record_inputs else None,
            metadata=self.metadata,
            attributes=_langchain_attributes(
                str(run_id), parent_run_id, run_type or "chain"
            ),
            started_at=started_at,
        )
        self._runs[str(run_id)] = _StoredRun(
            owning_trace_id=parent.owning_trace_id,
            root_run_id=parent.root_run_id,
            kind="chain",
            started_at=started_at,
            owns_trace=False,
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_chain_end(self, outputs: Any, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        ended_at = _now()
        stored = self._traces.get(run.owning_trace_id)

        if run.handle is not None:
            run.handle.end(
                output=outputs if self.record_outputs else None,
                ended_at=ended_at,
                duration_ms=_duration_ms(run.started_at, ended_at),
            )

        if stored is not None:
            self._note_bounds(stored, run.started_at, ended_at)
            if run.owns_trace:
                self._note_root_output(stored, outputs)
            if run.owns_trace:
                self._finalize(run.owning_trace_id, stored)

    def on_chain_error(self, error: BaseException, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        ended_at = _now()
        message = _error_message(error)
        stored = self._traces.get(run.owning_trace_id)

        if run.handle is not None:
            run.handle.end(
                status="ERROR",
                error=message if self.record_outputs else None,
                ended_at=ended_at,
                duration_ms=_duration_ms(run.started_at, ended_at),
            )

        if stored is not None:
            self._note_bounds(stored, run.started_at, ended_at)
            if run.owns_trace:
                self._note_root_error(stored, message)
                self._finalize(run.owning_trace_id, stored)

    def on_llm_start(
        self,
        serialized: Any,
        prompts: list[str],
        *,
        run_id: str,
        parent_run_id: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        invocation_params: dict[str, Any] | None = None,
        **_: Any,
    ) -> None:
        started_at = _now()
        stored, parent_id, owns_trace, owning_trace_id, root_run_id = (
            self._resolve_attachment(
                str(run_id),
                parent_run_id,
                lambda: self._create_owned_trace(
                    str(run_id),
                    self._trace_name(serialized, "langchain-llm"),
                    prompts,
                    "llm",
                    metadata,
                    tags,
                ),
            )
        )

        if owns_trace:
            self._note_root_input(stored, prompts)
        self._apply_identity(stored, metadata, tags)
        self._note_bounds(stored, started_at, None)

        provider = llm_provider(serialized, invocation_params)
        model = _model_name(serialized, invocation_params)
        handle = stored.context.start_generation(
            name=_serialized_name(serialized, "langchain-llm"),
            parent_id=parent_id,
            input=prompts if self.record_inputs else None,
            metadata=self.metadata,
            model=model,
            llm_provider=provider,
            llm_input_messages=(
                [{"role": "user", "content": prompt} for prompt in prompts]
                if self.record_inputs
                else None
            ),
            llm_invocation_parameters=invocation_params,
            attributes=_langchain_attributes(str(run_id), parent_run_id, "llm"),
            started_at=started_at,
        )
        self._runs[str(run_id)] = _StoredRun(
            owning_trace_id=owning_trace_id,
            root_run_id=root_run_id,
            kind="llm",
            started_at=started_at,
            owns_trace=owns_trace,
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_chat_model_start(
        self,
        serialized: Any,
        messages: list[list[Any]],
        *,
        run_id: str,
        parent_run_id: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        invocation_params: dict[str, Any] | None = None,
        **_: Any,
    ) -> None:
        started_at = _now()
        flat_messages = [message for group in messages for message in group]
        normalized = normalize_messages(flat_messages) if self.record_inputs else None

        stored, parent_id, owns_trace, owning_trace_id, root_run_id = (
            self._resolve_attachment(
                str(run_id),
                parent_run_id,
                lambda: self._create_owned_trace(
                    str(run_id),
                    self._trace_name(serialized, "langchain-chat-model"),
                    flat_messages,
                    "llm",
                    metadata,
                    tags,
                ),
            )
        )

        if owns_trace:
            self._note_root_input(stored, flat_messages)
        self._apply_identity(stored, metadata, tags)
        self._note_bounds(stored, started_at, None)

        provider = llm_provider(serialized, invocation_params)
        model = _model_name(serialized, invocation_params)
        handle = stored.context.start_generation(
            name=_serialized_name(serialized, "langchain-chat-model"),
            parent_id=parent_id,
            input=normalized if self.record_inputs else None,
            metadata=self.metadata,
            model=model,
            llm_provider=provider,
            llm_input_messages=normalized,
            llm_invocation_parameters=invocation_params,
            attributes=_langchain_attributes(str(run_id), parent_run_id, "llm"),
            started_at=started_at,
        )
        self._runs[str(run_id)] = _StoredRun(
            owning_trace_id=owning_trace_id,
            root_run_id=root_run_id,
            kind="llm",
            started_at=started_at,
            owns_trace=owns_trace,
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_llm_end(self, response: Any, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None or run.handle is None:
            return
        ended_at = _now()
        structured = llm_structured_output(response)
        output_messages = llm_output_messages(response)
        soft_error = tool_result_error(structured)

        run.handle.end(
            output=structured if self.record_outputs and soft_error is None else None,
            error=soft_error if self.record_outputs else None,
            status="ERROR" if soft_error else None,
            ended_at=ended_at,
            duration_ms=_duration_ms(run.started_at, ended_at),
            llm_output_messages=(
                output_messages
                if self.record_outputs and soft_error is None
                else None
            ),
        )

        stored = self._traces.get(run.owning_trace_id)
        if stored is not None:
            self._note_bounds(stored, run.started_at, ended_at)
            if run.owns_trace:
                if soft_error:
                    self._note_root_error(stored, soft_error)
                else:
                    self._note_root_output(stored, structured)
            elif soft_error is None and stored.root_output is None:
                self._note_root_output(stored, structured)

        self._maybe_finalize_owner(run, ended_at)

    def on_llm_error(self, error: BaseException, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        ended_at = _now()
        message = _error_message(error)
        if run.handle is not None:
            run.handle.end(
                status="ERROR",
                error=message if self.record_outputs else None,
                ended_at=ended_at,
                duration_ms=_duration_ms(run.started_at, ended_at),
            )
        stored = self._traces.get(run.owning_trace_id)
        if stored is not None:
            self._note_bounds(stored, run.started_at, ended_at)
            if run.owns_trace:
                self._note_root_error(stored, message)
        self._maybe_finalize_owner(run, ended_at)

    def on_tool_start(
        self,
        serialized: Any,
        input_str: Any,
        *,
        run_id: str,
        parent_run_id: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **_: Any,
    ) -> None:
        started_at = _now()
        stored, parent_id, owns_trace, owning_trace_id, root_run_id = (
            self._resolve_attachment(
                str(run_id),
                parent_run_id,
                lambda: self._create_owned_trace(
                    str(run_id),
                    self._trace_name(serialized, "langchain-tool"),
                    input_str,
                    "tool",
                    metadata,
                    tags,
                ),
            )
        )

        if owns_trace:
            self._note_root_input(stored, input_str)
        self._apply_identity(stored, metadata, tags)
        self._note_bounds(stored, started_at, None)

        name = _serialized_name(serialized, "langchain-tool")
        handle = stored.context.start_tool(
            name=name,
            parent_id=parent_id,
            tool_name=name,
            input=input_str if self.record_inputs else None,
            metadata=self.metadata,
            attributes=_langchain_attributes(str(run_id), parent_run_id, "tool"),
            started_at=started_at,
        )
        self._runs[str(run_id)] = _StoredRun(
            owning_trace_id=owning_trace_id,
            root_run_id=root_run_id,
            kind="tool",
            started_at=started_at,
            owns_trace=owns_trace,
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_tool_end(self, output: Any, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        ended_at = _now()
        soft_error = tool_result_error(output)
        if run.handle is not None:
            if soft_error is not None:
                run.handle.end(
                    status="ERROR",
                    error=soft_error if self.record_outputs else None,
                    ended_at=ended_at,
                    duration_ms=_duration_ms(run.started_at, ended_at),
                )
            else:
                run.handle.end(
                    output=output if self.record_outputs else None,
                    ended_at=ended_at,
                    duration_ms=_duration_ms(run.started_at, ended_at),
                )

        stored = self._traces.get(run.owning_trace_id)
        if stored is not None:
            self._note_bounds(stored, run.started_at, ended_at)
            if run.owns_trace:
                if soft_error is not None:
                    self._note_root_error(stored, soft_error)
                else:
                    self._note_root_output(stored, output)

        self._maybe_finalize_owner(run, ended_at)

    def on_tool_error(self, error: BaseException, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        ended_at = _now()
        message = _error_message(error)
        if run.handle is not None:
            run.handle.end(
                status="ERROR",
                error=message if self.record_outputs else None,
                ended_at=ended_at,
                duration_ms=_duration_ms(run.started_at, ended_at),
            )
        stored = self._traces.get(run.owning_trace_id)
        if stored is not None:
            self._note_bounds(stored, run.started_at, ended_at)
            if run.owns_trace:
                self._note_root_error(stored, message)
        self._maybe_finalize_owner(run, ended_at)

    def on_retriever_start(
        self,
        serialized: Any,
        query: str,
        *,
        run_id: str,
        parent_run_id: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **_: Any,
    ) -> None:
        started_at = _now()
        stored, parent_id, owns_trace, owning_trace_id, root_run_id = (
            self._resolve_attachment(
                str(run_id),
                parent_run_id,
                lambda: self._create_owned_trace(
                    str(run_id),
                    self._trace_name(serialized, "langchain-retriever"),
                    query,
                    "retriever",
                    metadata,
                    tags,
                ),
            )
        )

        if owns_trace:
            self._note_root_input(stored, query)
        self._apply_identity(stored, metadata, tags)
        self._note_bounds(stored, started_at, None)

        handle = stored.context.start_span(
            name=_serialized_name(serialized, "langchain-retriever"),
            parent_id=parent_id,
            input=query if self.record_inputs else None,
            metadata=self.metadata,
            attributes=_langchain_attributes(str(run_id), parent_run_id, "retriever"),
            started_at=started_at,
        )
        self._runs[str(run_id)] = _StoredRun(
            owning_trace_id=owning_trace_id,
            root_run_id=root_run_id,
            kind="retriever",
            started_at=started_at,
            owns_trace=owns_trace,
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_retriever_end(self, documents: list[Any], *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        ended_at = _now()
        if run.handle is not None:
            run.handle.end(
                output=documents if self.record_outputs else None,
                ended_at=ended_at,
                duration_ms=_duration_ms(run.started_at, ended_at),
            )
        stored = self._traces.get(run.owning_trace_id)
        if stored is not None:
            self._note_bounds(stored, run.started_at, ended_at)
            if run.owns_trace:
                self._note_root_output(stored, documents)
        self._maybe_finalize_owner(run, ended_at)

    def on_retriever_error(
        self, error: BaseException, *, run_id: str, **_: Any
    ) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        ended_at = _now()
        message = _error_message(error)
        if run.handle is not None:
            run.handle.end(
                status="ERROR",
                error=message if self.record_outputs else None,
                ended_at=ended_at,
                duration_ms=_duration_ms(run.started_at, ended_at),
            )
        stored = self._traces.get(run.owning_trace_id)
        if stored is not None:
            self._note_bounds(stored, run.started_at, ended_at)
            if run.owns_trace:
                self._note_root_error(stored, message)
        self._maybe_finalize_owner(run, ended_at)

    def flush(self) -> None:
        """Finalize all open owned traces (idempotent; does not resend)."""
        for trace_id, stored in list(self._traces.items()):
            self._finalize(trace_id, stored)

    def shutdown(self) -> None:
        """Finalize open traces and reset integration state."""
        self.flush()
        self._runs.clear()
        self._traces.clear()


def langchain(**options: Any) -> LemmaLangChainCallbackHandler:
    return LemmaLangChainCallbackHandler(**options)


def langgraph(**options: Any) -> LemmaLangChainCallbackHandler:
    """LangGraph adapter: LangChain callbacks with a LangGraph default name."""
    return LemmaLangChainCallbackHandler(
        **{"agent_name": "langgraph-agent", **options}
    )
