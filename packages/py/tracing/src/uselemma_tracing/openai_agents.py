from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .client import Lemma, SpanHandle, TraceContext, _datetime_or_now, _duration_ms, _now
from .debug_mode import _lemma_debug
from .tool_result import tool_result_error


@dataclass
class _StoredTrace:
    context: TraceContext
    started_at: datetime
    ended: bool = False


def _get(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _span_data(span: Any) -> dict[str, Any]:
    data = _get(span, "span_data", {})
    if isinstance(data, dict):
        return dict(data)
    export = getattr(data, "export", None)
    if callable(export):
        exported = export()
        if isinstance(exported, dict):
            return exported
    return {
        key: getattr(data, key)
        for key in dir(data)
        if not key.startswith("_") and not callable(getattr(data, key))
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
        return None
    if isinstance(response, dict):
        return response
    model_dump = getattr(response, "model_dump", None)
    if callable(model_dump):
        return model_dump()
    return str(response)


def _span_name(data: dict[str, Any]) -> str:
    if isinstance(data.get("name"), str) and data["name"]:
        return data["name"]
    span_type = data.get("type")
    if span_type == "generation":
        return "openai-agents-generation"
    if span_type == "response":
        return "openai-agents-response"
    if span_type == "handoff":
        from_agent = data.get("from_agent")
        to_agent = data.get("to_agent")
        if from_agent and to_agent:
            return f"{from_agent} to {to_agent}"
        return "openai-agents-handoff"
    return f"openai-agents-{span_type or 'span'}"


def _attributes(span: Any, data: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in {
            "openai.agents.trace_id": _get(span, "trace_id"),
            "openai.agents.span_id": _get(span, "span_id"),
            "openai.agents.parent_id": _get(span, "parent_id"),
            "openai.agents.span_type": data.get("type"),
            "openai.agents.trace_metadata": _json(_get(span, "trace_metadata")),
            "openai.agents.span_data": _json(data),
        }.items()
        if value is not None
    }


class LemmaOpenAIAgentsProcessor:
    def __init__(
        self,
        lemma: Lemma | None = None,
        *,
        api_key: str | None = None,
        project_id: str | None = None,
        base_url: str = "https://api.uselemma.ai",
        record_inputs: bool = True,
        record_outputs: bool = True,
    ) -> None:
        self.lemma = lemma or Lemma(
            api_key=api_key,
            project_id=project_id,
            base_url=base_url,
        )
        self.record_inputs = record_inputs
        self.record_outputs = record_outputs
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
            self._finalize(trace_id, stored)

    def on_span_start(self, span: Any) -> None:
        with self._lock:
            handle = self._start_span(span)
            if handle is not None:
                span_id = _get(span, "span_id")
                self._spans[span_id] = handle
                self._span_trace_ids[span_id] = _get(span, "trace_id")

    def on_span_end(self, span: Any) -> None:
        with self._lock:
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

    def _forget_trace_spans(self, trace_id: str) -> None:
        for span_id, owner in list(self._span_trace_ids.items()):
            if owner != trace_id:
                continue
            self._span_trace_ids.pop(span_id, None)
            self._spans.pop(span_id, None)
            self._ended_spans.pop(span_id, None)

    def _finalize(self, trace_id: str, stored: _StoredTrace) -> None:
        if not stored.ended:
            stored.ended = True
            self.lemma._send(stored.context, stored.started_at, _now())
        self._traces.pop(trace_id, None)
        self._forget_trace_spans(trace_id)

    def _ensure_trace(self, trace: Any) -> _StoredTrace:
        trace_id = _get(trace, "trace_id")
        existing = self._traces.get(trace_id)
        if existing is not None:
            return existing

        metadata = dict(_get(trace, "metadata", {}) or {})
        metadata["openai_agents_trace_id"] = trace_id
        group_id = _get(trace, "group_id")
        if group_id is not None:
            metadata["openai_agents_group_id"] = group_id

        context = TraceContext(
            name=_get(trace, "name", "openai-agents-trace"),
            metadata=metadata,
            thread_id=group_id,
        )
        _lemma_debug("client", "trace started", name=context.name)
        stored = _StoredTrace(context=context, started_at=_now())
        self._traces[trace_id] = stored
        return stored

    def _trace_for_span(self, span: Any) -> TraceContext | None:
        trace_id = _get(span, "trace_id")
        stored = self._traces.get(trace_id)
        if stored is None:
            return None
        return stored.context

    def _start_span(self, span: Any) -> SpanHandle | None:
        trace = self._trace_for_span(span)
        if trace is None:
            return None
        data = _span_data(span)
        span_type = data.get("type")
        common = {
            "id": _get(span, "span_id"),
            "parent_id": _get(span, "parent_id"),
            "name": _span_name(data),
            "input": (
                _parse_maybe_json(data.get("input") or data.get("_input"))
                if self.record_inputs
                else None
            ),
            "attributes": _attributes(span, data),
            "started_at": _datetime_or_now(_get(span, "started_at")),
        }
        if span_type in {"generation", "response"}:
            return trace.start_generation(
                **common,
                model=data.get("model"),
                llm_provider="openai",
                llm_invocation_parameters=data.get("model_config"),
                llm_input_messages=(
                    data.get("input") if self.record_inputs and isinstance(data.get("input"), list) else None
                ),
            )
        if span_type == "function":
            return trace.start_tool(
                **common,
                tool_name=data.get("name") if isinstance(data.get("name"), str) else None,
            )
        return trace.start_span(**common)

    def _end_span(self, handle: SpanHandle, span: Any) -> None:
        data = _span_data(span)
        span_type = data.get("type")
        # Parse outputs for soft-error detection even when payloads are not recorded.
        if span_type == "generation":
            raw_output = _generation_output(data.get("output"))
        elif span_type == "response":
            raw_output = _response_output(data)
        else:
            raw_output = _parse_maybe_json(data.get("output"))

        error = _get(span, "error")
        error_message = None
        if isinstance(error, dict):
            error_message = error.get("message")
        else:
            error_message = getattr(error, "message", None)

        soft_error = (
            tool_result_error(raw_output) if span_type == "function" else None
        )
        if error_message is None:
            error_message = soft_error

        output = None if (not self.record_outputs or error_message) else raw_output
        span_ended_at = _get(span, "ended_at")
        handle.end(
            # Failures must not invent an output — record error instead.
            output=output,
            error=error_message if self.record_outputs else None,
            status="ERROR" if error_message else None,
            model=data.get("model"),
            ended_at=span_ended_at,
            duration_ms=_duration_ms(_get(span, "started_at"), span_ended_at),
            llm_output_messages=(
                data.get("output")
                if (
                    not error_message
                    and self.record_outputs
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
        if parent_id and span_type == "function" and span_ended_at is not None:
            parent = self._spans.get(parent_id) or self._ended_spans.get(parent_id)
            if parent is not None:
                parent.ensure_ended_at(span_ended_at)


def openai_agents(
    lemma: Lemma | None = None,
    *,
    api_key: str | None = None,
    project_id: str | None = None,
    base_url: str = "https://api.uselemma.ai",
    record_inputs: bool = True,
    record_outputs: bool = True,
) -> LemmaOpenAIAgentsProcessor:
    return LemmaOpenAIAgentsProcessor(
        lemma,
        api_key=api_key,
        project_id=project_id,
        base_url=base_url,
        record_inputs=record_inputs,
        record_outputs=record_outputs,
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
