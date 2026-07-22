from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .client import Lemma, SpanHandle, TraceContext, _datetime_or_now, _duration_ms, _now
from .debug_mode import _lemma_debug
from .tool_result import tool_result_error

_LIVE_SPAN_DATA_KEYS = (
    "type",
    "name",
    "input",
    "output",
    "response",
    "model",
    "model_config",
    "from_agent",
    "to_agent",
    "_input",
    "_response",
)


@dataclass
class _StoredTrace:
    context: TraceContext
    started_at: datetime
    ended: bool = False
    root_input: Any = field(default=None)
    root_output: Any = field(default=None)
    root_error: str | None = None
    earliest_start: datetime | None = None
    latest_end: datetime | None = None
    _has_root_input: bool = False


def _get(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _span_data(span: Any) -> dict[str, Any]:
    """Prefer live attributes on span_data objects over ``export()``.

    OpenAI Agents ``export()`` often stringifies ``output`` / omits ``response``.
    Live attrs keep structured tool results and response objects intact.
    """
    data = _get(span, "span_data", {})
    if isinstance(data, dict):
        return dict(data)

    live: dict[str, Any] = {}
    for key in _LIVE_SPAN_DATA_KEYS:
        if hasattr(data, key):
            live[key] = getattr(data, key)

    exported: dict[str, Any] = {}
    export = getattr(data, "export", None)
    if callable(export):
        try:
            result = export()
            if isinstance(result, dict):
                exported = dict(result)
        except Exception:
            exported = {}

    if exported:
        merged = dict(exported)
        for key, value in live.items():
            if value is not None:
                merged[key] = value
        return merged

    if live:
        return {key: value for key, value in live.items() if value is not None}

    return {
        key: getattr(data, key)
        for key in dir(data)
        if not key.startswith("_") and not callable(getattr(data, key, None))
    }


def _parse_maybe_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _json(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return json.dumps(value, separators=(",", ":"), default=str)
    except TypeError:
        return str(value)


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


def _message_content(message: Any) -> Any:
    if not isinstance(message, dict):
        return message
    if "content" in message:
        return message["content"]
    return message


def _root_trace_input(input_value: Any) -> Any:
    """Prefer the current user turn for the Lemma root input."""
    if isinstance(input_value, str):
        return input_value
    if not isinstance(input_value, list) or not input_value:
        return input_value

    for message in reversed(input_value):
        if isinstance(message, dict) and message.get("role") == "user":
            return _message_content(message)

    return _message_content(input_value[-1])


def _generation_output(output: Any) -> Any:
    if not isinstance(output, list):
        return output
    text = "".join(
        str(item.get("text") or item.get("content") or "")
        for item in output
        if isinstance(item, dict)
    )
    return text or output


def _response_output(data: dict[str, Any]) -> Any:
    response = data.get("response")
    if response is None:
        response = data.get("_response")
    if response is None:
        return _generation_output(data.get("output"))
    if isinstance(response, dict):
        if isinstance(response.get("output_text"), str):
            return response["output_text"]
        if isinstance(response.get("output"), list):
            return _generation_output(response["output"])
        return response
    model_dump = getattr(response, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump()
        if isinstance(dumped, dict):
            if isinstance(dumped.get("output_text"), str):
                return dumped["output_text"]
            if isinstance(dumped.get("output"), list):
                return _generation_output(dumped["output"])
            return dumped
        return dumped
    return str(response)


def _span_name(data: dict[str, Any]) -> str:
    if isinstance(data.get("name"), str) and data["name"]:
        return data["name"]
    span_type = data.get("type")
    if span_type == "generation":
        return "openai-agents-generation"
    if span_type == "response":
        return "openai-agents-response"
    if span_type == "agent":
        return "openai-agents-agent"
    if span_type == "guardrail":
        return "openai-agents-guardrail"
    if span_type == "handoff":
        from_agent = data.get("from_agent")
        to_agent = data.get("to_agent")
        if from_agent and to_agent:
            return f"{from_agent} to {to_agent}"
        return "openai-agents-handoff"
    if span_type in {"speech", "transcription"}:
        return f"openai-agents-{span_type}"
    if span_type == "mcp_tools":
        return "openai-agents-mcp-tools"
    return f"openai-agents-{span_type or 'span'}"


def _attributes(
    span: Any,
    data: dict[str, Any],
    *,
    record_payloads: bool,
) -> dict[str, Any]:
    return {
        key: value
        for key, value in {
            "openai.agents.trace_id": _get(span, "trace_id"),
            "openai.agents.span_id": _get(span, "span_id"),
            "openai.agents.parent_id": _get(span, "parent_id"),
            "openai.agents.span_type": data.get("type"),
            "openai.agents.trace_metadata": (
                _json(_get(span, "trace_metadata")) if record_payloads else None
            ),
            # Full span_data can contain prompts/outputs — omit when privacy is on.
            "openai.agents.span_data": _json(data) if record_payloads else None,
        }.items()
        if value is not None
    }


def _is_generation_type(span_type: Any) -> bool:
    return span_type in {"generation", "response"}


def _is_terminal_failure_type(span_type: Any) -> bool:
    return span_type in {"agent", "task", "custom", "guardrail"}


def _span_input(data: dict[str, Any]) -> Any:
    return _parse_maybe_json(data.get("input") if data.get("input") is not None else data.get("_input"))


class LemmaOpenAIAgentsProcessor:
    def __init__(
        self,
        lemma: Lemma | None = None,
        *,
        api_key: str | None = None,
        project_id: str | None = None,
        base_url: str = "https://api.uselemma.ai",
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
        )
        self.metadata = metadata
        self.record_inputs = record_inputs
        self.record_outputs = record_outputs
        self.thread_id_key = thread_id_key
        self.user_id_key = user_id_key
        self._traces: dict[str, _StoredTrace] = {}
        self._spans: dict[str, SpanHandle] = {}
        self._span_trace_ids: dict[str, str] = {}
        self._ended_spans: dict[str, SpanHandle] = {}
        self._lock = threading.RLock()

    def on_trace_start(self, trace: Any) -> None:
        with self._lock:
            self._ensure_trace(trace)

    def on_trace_end(self, trace: Any) -> None:
        with self._lock:
            trace_id = _get(trace, "trace_id")
            stored = self._traces.get(trace_id)
            # Look up (don't ensure) so a trace already finalized by
            # force_flush/shutdown isn't recreated and sent a second time,
            # which would duplicate its spans in the append-only ingest store.
            if stored is None:
                return
            self._apply_identity(
                stored,
                _get(trace, "group_id"),
                _get(trace, "metadata"),
            )
            self._finalize(trace_id, stored)

    def on_span_start(self, span: Any) -> None:
        with self._lock:
            # Only record spans when the owning trace is already known.
            if _get(span, "trace_id") not in self._traces:
                return
            handle = self._start_span(span)
            if handle is not None:
                span_id = _get(span, "span_id")
                self._spans[span_id] = handle
                self._span_trace_ids[span_id] = _get(span, "trace_id")

    def on_span_end(self, span: Any) -> None:
        with self._lock:
            if _get(span, "trace_id") not in self._traces:
                return
            span_id = _get(span, "span_id")
            handle = self._spans.pop(span_id, None) or self._start_span(span)
            if handle is None:
                return
            self._end_span(handle, span)

    def shutdown(self) -> None:
        self.force_flush()

    def force_flush(self) -> None:
        # Finalize any still-open traces exactly once (a one-time terminal send
        # for traces that never received on_trace_end), then drop them so a
        # later on_trace_end or force_flush can't resend and duplicate spans.
        with self._lock:
            for trace_id, stored in list(self._traces.items()):
                self._finalize(trace_id, stored)

    def _resolve_thread_id(
        self,
        group_id: Any = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        if isinstance(group_id, str) and group_id:
            return group_id
        keys = [self.thread_id_key]
        if self.thread_id_key != "thread_id":
            keys.append("thread_id")
        if "threadId" not in keys:
            keys.append("threadId")
        return _lookup_string([metadata, self.metadata], keys)

    def _resolve_user_id(self, metadata: dict[str, Any] | None = None) -> str | None:
        if self.user_id_key:
            return _lookup_string([metadata, self.metadata], [self.user_id_key])
        return _lookup_string(
            [metadata, self.metadata],
            ["userId", "user_id", "resourceId"],
        )

    def _apply_identity(
        self,
        stored: _StoredTrace,
        group_id: Any = None,
        metadata: Any = None,
    ) -> None:
        meta = dict(metadata or {}) if metadata else None
        thread_id = self._resolve_thread_id(group_id, meta)
        user_id = self._resolve_user_id(meta)
        if thread_id:
            stored.context.thread_id = thread_id
        if user_id:
            stored.context.user_id = user_id

    def _note_bounds(
        self,
        stored: _StoredTrace,
        start: datetime | None,
        end: datetime | None,
    ) -> None:
        if start is not None:
            if stored.earliest_start is None or start < stored.earliest_start:
                stored.earliest_start = start
        if end is not None:
            if stored.latest_end is None or end > stored.latest_end:
                stored.latest_end = end

    def _note_root_input(self, stored: _StoredTrace, input_value: Any) -> None:
        if not self.record_inputs or input_value is None or stored._has_root_input:
            return
        stored.root_input = _root_trace_input(input_value)
        stored._has_root_input = True
        stored.context.input = stored.root_input

    def _note_root_output(self, stored: _StoredTrace, output: Any) -> None:
        if not self.record_outputs or output is None or stored.root_error:
            return
        stored.root_output = output

    def _note_root_error(self, stored: _StoredTrace, error: str | None) -> None:
        if not error or stored.root_error:
            return
        stored.root_error = error

    def _forget_trace_spans(self, trace_id: str) -> None:
        for span_id, owner in list(self._span_trace_ids.items()):
            if owner != trace_id:
                continue
            self._span_trace_ids.pop(span_id, None)
            self._spans.pop(span_id, None)
            self._ended_spans.pop(span_id, None)

    def _finalize(self, trace_id: str, stored: _StoredTrace) -> None:
        self._traces.pop(trace_id, None)
        self._forget_trace_spans(trace_id)
        if stored.ended:
            return
        stored.ended = True

        ended_at = stored.latest_end or _now()
        started_at = stored.earliest_start or stored.started_at or ended_at
        root_duration = _duration_ms(started_at, ended_at)
        if root_duration is not None:
            stored.context.duration_ms = root_duration

        if stored.root_error:
            stored.context.fail(
                "error" if not self.record_outputs else stored.root_error
            )
            self.lemma._send(stored.context, started_at, ended_at)
            return

        if self.record_outputs and stored.root_output is not None:
            stored.context.output(stored.root_output)

        self.lemma._send(stored.context, started_at, ended_at)

    def _ensure_trace(self, trace: Any) -> _StoredTrace:
        trace_id = _get(trace, "trace_id")
        existing = self._traces.get(trace_id)
        if existing is not None:
            self._apply_identity(
                existing,
                _get(trace, "group_id"),
                _get(trace, "metadata"),
            )
            return existing

        trace_metadata = dict(_get(trace, "metadata", {}) or {})
        metadata = {
            **(self.metadata or {}),
            **trace_metadata,
            "openai_agents_trace_id": trace_id,
        }
        group_id = _get(trace, "group_id")
        if group_id is not None:
            metadata["openai_agents_group_id"] = group_id

        context = TraceContext(
            name=_get(trace, "name", "openai-agents-trace") or "openai-agents-trace",
            metadata=metadata,
            thread_id=self._resolve_thread_id(group_id, trace_metadata),
            user_id=self._resolve_user_id(trace_metadata),
        )
        _lemma_debug("client", "trace started", name=context.name)
        stored = _StoredTrace(context=context, started_at=_now())
        self._traces[trace_id] = stored
        return stored

    def _stored_for_span(self, span: Any) -> _StoredTrace | None:
        return self._traces.get(_get(span, "trace_id"))

    def _start_span(self, span: Any) -> SpanHandle | None:
        stored = self._stored_for_span(span)
        if stored is None:
            return None

        self._apply_identity(stored, None, _get(span, "trace_metadata"))
        data = _span_data(span)
        span_type = data.get("type")
        input_value = _span_input(data)
        if _is_generation_type(span_type):
            self._note_root_input(stored, input_value)

        span_started_at = _datetime_or_now(_get(span, "started_at"))
        self._note_bounds(stored, span_started_at, None)

        common = {
            "id": _get(span, "span_id"),
            "parent_id": _get(span, "parent_id"),
            "name": _span_name(data),
            "input": input_value if self.record_inputs else None,
            "metadata": self.metadata,
            "attributes": _attributes(
                span,
                data,
                record_payloads=self.record_inputs and self.record_outputs,
            ),
            "started_at": span_started_at,
        }
        if _is_generation_type(span_type):
            return stored.context.start_generation(
                **common,
                model=data.get("model") if isinstance(data.get("model"), str) else None,
                llm_provider="openai",
                llm_invocation_parameters=data.get("model_config"),
                llm_input_messages=(
                    input_value
                    if self.record_inputs and isinstance(input_value, list)
                    else None
                ),
            )
        if span_type == "function":
            return stored.context.start_tool(
                **common,
                tool_name=data.get("name") if isinstance(data.get("name"), str) else None,
            )
        return stored.context.start_span(**common)

    def _end_span(self, handle: SpanHandle, span: Any) -> None:
        stored = self._stored_for_span(span)
        if stored is None:
            return

        self._apply_identity(stored, None, _get(span, "trace_metadata"))
        data = _span_data(span)
        span_type = data.get("type")
        input_value = _span_input(data)
        if _is_generation_type(span_type):
            self._note_root_input(stored, input_value)

        # Parse outputs for soft-error detection even when payloads are not recorded.
        if span_type == "generation":
            raw_output = _generation_output(data.get("output"))
        elif span_type == "response":
            raw_output = _response_output(data)
        else:
            raw_output = _parse_maybe_json(
                data.get("output") if data.get("output") is not None else data.get("_response")
            )

        error = _get(span, "error")
        hard_error = None
        if isinstance(error, dict):
            hard_error = error.get("message")
        else:
            hard_error = getattr(error, "message", None)
        if hard_error is not None and not isinstance(hard_error, str):
            hard_error = str(hard_error)

        soft_error = (
            tool_result_error(raw_output) if span_type == "function" else None
        )
        error_message = hard_error or soft_error or None

        output = None if (not self.record_outputs or error_message) else raw_output
        raw_started_at = _get(span, "started_at")
        raw_ended_at = _get(span, "ended_at")
        span_started_at = _datetime_or_now(raw_started_at)
        span_ended_at = _datetime_or_now(raw_ended_at)
        self._note_bounds(stored, span_started_at, span_ended_at)

        # Root failure only from hard terminal/agent/task/guardrail errors —
        # not recovered child soft tool errors when a later generation succeeds.
        if hard_error and _is_terminal_failure_type(span_type):
            self._note_root_error(stored, hard_error)
        if not error_message and _is_generation_type(span_type) and output is not None:
            self._note_root_output(stored, output)

        # Prefer the original string timestamp so payload ISO matches the SDK.
        ended_at_value = raw_ended_at if raw_ended_at is not None else span_ended_at
        handle.end(
            # Failures must not invent an output — record error instead.
            output=output,
            error=error_message if self.record_outputs else None,
            status="ERROR" if error_message else None,
            model=data.get("model") if isinstance(data.get("model"), str) else None,
            ended_at=ended_at_value,
            duration_ms=_duration_ms(raw_started_at, ended_at_value),
            llm_output_messages=(
                data.get("output")
                if (
                    not error_message
                    and self.record_outputs
                    and span_type == "generation"
                    and isinstance(data.get("output"), list)
                )
                else None
            ),
        )
        span_id = _get(span, "span_id")
        if span_id is not None:
            self._ended_spans[span_id] = handle
            self._span_trace_ids[span_id] = _get(span, "trace_id")

        parent_id = _get(span, "parent_id")
        if parent_id and span_type == "function":
            parent = self._spans.get(parent_id) or self._ended_spans.get(parent_id)
            if parent is not None:
                parent.ensure_ended_at(ended_at_value)


def openai_agents(
    lemma: Lemma | None = None,
    *,
    api_key: str | None = None,
    project_id: str | None = None,
    base_url: str = "https://api.uselemma.ai",
    metadata: dict[str, Any] | None = None,
    record_inputs: bool = True,
    record_outputs: bool = True,
    thread_id_key: str = "thread_id",
    user_id_key: str | None = None,
) -> LemmaOpenAIAgentsProcessor:
    return LemmaOpenAIAgentsProcessor(
        lemma,
        api_key=api_key,
        project_id=project_id,
        base_url=base_url,
        metadata=metadata,
        record_inputs=record_inputs,
        record_outputs=record_outputs,
        thread_id_key=thread_id_key,
        user_id_key=user_id_key,
    )


def instrument_openai_agents(
    processor: LemmaOpenAIAgentsProcessor | None = None,
    **options: Any,
) -> LemmaOpenAIAgentsProcessor:
    processor = processor or openai_agents(**options)
    try:
        from agents import add_trace_processor
    except ImportError as exc:
        raise ImportError(
            "uselemma-tracing: install openai-agents to use instrument_openai_agents()"
        ) from exc
    add_trace_processor(processor)
    return processor
