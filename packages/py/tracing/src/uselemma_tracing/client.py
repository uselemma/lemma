from __future__ import annotations

import inspect
import json
import os
import time
import urllib.error
import urllib.request
import uuid
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version as package_version
from typing import Any, Callable, Literal, TypeVar

from .debug_delivery import (
    EXPECTED_INGEST_SUCCESS_STATUS,
    INGEST_PATH,
    INGEST_STATUS_PATH,
    INGEST_STATUS_POLL_INTERVAL_SECONDS,
    INGEST_STATUS_POLL_TIMEOUT_SECONDS,
    api_key_suffix,
    build_config_warnings,
    ingest_failure_hint,
    is_successful_ingest_status,
    parse_ingest_status,
    pick_response_headers,
)
from .debug_mode import _lemma_debug, is_debug_mode_enabled, is_debug_verify_enabled
from .error_message import describe_error as _describe_error
from .error_message import failure_message as _failure_message
from .release import normalize_release
from .usage import normalize_token_usage, token_usage_attributes

T = TypeVar("T")
SpanType = Literal["span", "generation", "tool"]
Status = Literal["OK", "ERROR"]

_SDK_LANGUAGE = "python"
_SDK_LANGUAGE_ATTR = "lemma.sdk.language"
_SDK_INTEGRATION_ATTR = "lemma.sdk.integration"

try:
    _SDK_VERSION = package_version("uselemma-tracing")
except PackageNotFoundError:
    _SDK_VERSION = "unknown"

_SDK_USER_AGENT = f"uselemma-tracing/{_SDK_VERSION}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat().replace("+00:00", "Z")


def _compact(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def _duration_ms(
    start: datetime | str | None, end: datetime | str | None
) -> int | None:
    if isinstance(start, str):
        start = _parse_datetime(start)
    if isinstance(end, str):
        end = _parse_datetime(end)
    if not isinstance(start, datetime) or not isinstance(end, datetime):
        return None
    return max(0, int((end - start).total_seconds() * 1000))


def _datetime_or_now(value: datetime | str | None) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        parsed = _parse_datetime(value)
        if parsed is not None:
            return parsed
    return _now()


def _parse_datetime(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _debug_span_summary(
    span: dict[str, Any], index: int | None = None
) -> dict[str, Any]:
    return _compact(
        {
            "index": index,
            "id": span.get("id"),
            "parent_id": span.get("parent_id"),
            "name": span.get("name"),
            "type": span.get("type"),
            "status": span.get("status"),
            "duration_ms": span.get("duration_ms"),
            "model": span.get("model"),
            "has_input": "input" in span,
            "has_output": "output" in span,
            "has_error": bool(span.get("error")),
        }
    )


def _serialize_attribute(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    try:
        return json.dumps(value, separators=(",", ":"))
    except TypeError:
        return str(value)


def _add_defined(attributes: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        attributes[key] = value


def _flatten_message(attributes: dict[str, Any], prefix: str, message: Any) -> None:
    if isinstance(message, dict):
        for key, value in message.items():
            _add_defined(
                attributes, f"{prefix}.message.{key}", _serialize_attribute(value)
            )
        return
    _add_defined(attributes, f"{prefix}.message.content", _serialize_attribute(message))


def _flatten_document(attributes: dict[str, Any], prefix: str, document: Any) -> None:
    if isinstance(document, dict):
        for key, value in document.items():
            _add_defined(
                attributes, f"{prefix}.document.{key}", _serialize_attribute(value)
            )
        return
    _add_defined(
        attributes, f"{prefix}.document.content", _serialize_attribute(document)
    )


def _span_attributes(
    attributes: dict[str, Any] | None = None,
    *,
    model: str | None = None,
    input_mime_type: str | None = None,
    output_mime_type: str | None = None,
    llm_model_name: str | None = None,
    llm_provider: str | None = None,
    llm_system: str | None = None,
    llm_invocation_parameters: Any = None,
    llm_input_messages: list[Any] | None = None,
    llm_output_messages: list[Any] | None = None,
    llm_tools: Any = None,
    llm_prompt_template: str | None = None,
    llm_prompt_template_variables: Any = None,
    llm_prompt_template_version: str | None = None,
    tool_description: str | None = None,
    tool_parameters: Any = None,
    user_facing_message: str | None = None,
    embedding_model_name: str | None = None,
    embedding_invocation_parameters: Any = None,
    embedding_embeddings: Any = None,
    reranker_model_name: str | None = None,
    reranker_input_documents: list[Any] | None = None,
    reranker_output_documents: list[Any] | None = None,
    usage: dict[str, int | float] | None = None,
) -> dict[str, Any] | None:
    caller = dict(attributes or {})
    integration = caller.get(_SDK_INTEGRATION_ATTR)
    if not isinstance(integration, str) or not integration:
        integration = "manual"

    attrs = dict(caller)
    _add_defined(attrs, "input.mime_type", input_mime_type)
    _add_defined(attrs, "output.mime_type", output_mime_type)
    model_identity = llm_model_name or model
    _add_defined(attrs, "llm.model_name", model_identity)
    _add_defined(attrs, "gen_ai.request.model", model_identity)
    _add_defined(attrs, "ai.model.id", model_identity)
    _add_defined(attrs, "llm.provider", llm_provider)
    _add_defined(attrs, "llm.system", llm_system)
    # gen_ai.system from llm_system when set, else llm_provider.
    _add_defined(attrs, "gen_ai.system", llm_system or llm_provider)
    attrs.update(token_usage_attributes(usage))
    _add_defined(
        attrs,
        "llm.invocation_parameters",
        _serialize_attribute(llm_invocation_parameters),
    )
    _add_defined(attrs, "llm.tools", _serialize_attribute(llm_tools))
    _add_defined(attrs, "llm.prompt_template.template", llm_prompt_template)
    _add_defined(
        attrs,
        "llm.prompt_template.variables",
        _serialize_attribute(llm_prompt_template_variables),
    )
    _add_defined(attrs, "llm.prompt_template.version", llm_prompt_template_version)
    _add_defined(attrs, "tool.description", tool_description)
    _add_defined(attrs, "tool.parameters", _serialize_attribute(tool_parameters))
    if user_facing_message is not None:
        attrs["lemma.tool.kind"] = "user_message"
        attrs["lemma.tool.message"] = user_facing_message
    _add_defined(attrs, "embedding.model_name", embedding_model_name)
    _add_defined(
        attrs,
        "embedding.invocation_parameters",
        _serialize_attribute(embedding_invocation_parameters),
    )
    _add_defined(
        attrs, "embedding.embeddings", _serialize_attribute(embedding_embeddings)
    )
    _add_defined(attrs, "reranker.model_name", reranker_model_name)
    for index, message in enumerate(llm_input_messages or []):
        _flatten_message(attrs, f"llm.input_messages.{index}", message)
    for index, message in enumerate(llm_output_messages or []):
        _flatten_message(attrs, f"llm.output_messages.{index}", message)
    for index, document in enumerate(reranker_input_documents or []):
        _flatten_document(attrs, f"reranker.input_documents.{index}", document)
    for index, document in enumerate(reranker_output_documents or []):
        _flatten_document(attrs, f"reranker.output_documents.{index}", document)

    attrs[_SDK_LANGUAGE_ATTR] = _SDK_LANGUAGE
    attrs[_SDK_INTEGRATION_ATTR] = integration
    return attrs or None


def _resolve_usage(usage: Any = None) -> dict[str, int | float] | None:
    return normalize_token_usage(usage)

@dataclass
class SpanHandle:
    trace: "TraceContext"
    name: str
    input: Any = None
    metadata: dict[str, Any] | None = None
    attributes: dict[str, Any] | None = None
    type: SpanType = "span"
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    parent_id: str | None = None
    started_at: datetime = field(default_factory=_now)
    model: str | None = None
    tool_name: str | None = None
    llm_provider: str | None = None
    llm_invocation_parameters: Any = None
    llm_input_messages: list[Any] | None = None
    llm_tools: Any = None
    usage: dict[str, int | float] | None = None
    payload: dict[str, Any] | None = None
    ended: bool = False
    user_facing_message: str | None = None

    def end(
        self,
        *,
        output: Any = None,
        duration_ms: int | None = None,
        status: Status | None = None,
        error: Any = None,
        ended_at: datetime | str | None = None,
        metadata: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        model: str | None = None,
        tool_name: str | None = None,
        llm_provider: str | None = None,
        llm_invocation_parameters: Any = None,
        llm_output_messages: list[Any] | None = None,
        input_mime_type: str | None = None,
        output_mime_type: str | None = None,
        embedding_model_name: str | None = None,
        embedding_invocation_parameters: Any = None,
        embedding_embeddings: Any = None,
        reranker_model_name: str | None = None,
        reranker_input_documents: list[Any] | None = None,
        reranker_output_documents: list[Any] | None = None,
        usage: dict[str, int | float] | None = None,
        input_tokens: int | float | None = None,
        output_tokens: int | float | None = None,
        cache_read_input_tokens: int | float | None = None,
        cache_creation_input_tokens: int | float | None = None,
        reasoning_output_tokens: int | float | None = None,
    ) -> None:
        if self.ended:
            return
        self.ended = True
        resolved_usage = _resolve_usage(
            usage
            if usage is not None
            else _compact(
                {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": cache_read_input_tokens,
                    "cache_creation_input_tokens": cache_creation_input_tokens,
                    "reasoning_output_tokens": reasoning_output_tokens,
                }
            )
            or self.usage
        )
        span = self.trace._build_span(
            name=self.name,
            input=self.input,
            output=output,
            metadata=metadata or self.metadata,
            attributes=attributes or self.attributes,
            model=self.model or model,
            tool_name=tool_name or self.tool_name,
            user_facing_message=self.user_facing_message,
            input_mime_type=input_mime_type,
            output_mime_type=output_mime_type,
            llm_provider=llm_provider or self.llm_provider,
            llm_invocation_parameters=(
                llm_invocation_parameters
                if llm_invocation_parameters is not None
                else self.llm_invocation_parameters
            ),
            llm_input_messages=self.llm_input_messages,
            llm_output_messages=llm_output_messages,
            llm_tools=self.llm_tools,
            embedding_model_name=embedding_model_name,
            embedding_invocation_parameters=embedding_invocation_parameters,
            embedding_embeddings=embedding_embeddings,
            reranker_model_name=reranker_model_name,
            reranker_input_documents=reranker_input_documents,
            reranker_output_documents=reranker_output_documents,
            usage=resolved_usage,
            status=status,
            error=error,
            id=self.id,
            started_at=self.started_at,
            ended_at=ended_at or _now(),
            duration_ms=duration_ms,
            parent_id=self.parent_id,
            type=self.type,
        )
        if self.payload is None:
            self.trace.spans.append(span)
            self.payload = span
        else:
            self.payload.clear()
            self.payload.update(span)
        self.trace._debug_span("span ended", self.payload)

    def ensure_ended_at(self, ended_at: datetime | str) -> None:
        """Extend this span's end when a child finished later.

        Only applies after end() — open parents are left alone so a later end()
        cannot overwrite a premature extension with a shorter duration.
        """
        if not self.ended or self.payload is None:
            return
        next_end = _datetime_or_now(ended_at)
        started = self.payload.get("started_at")
        started_dt = (
            started
            if isinstance(started, datetime)
            else _parse_datetime(started)
            if isinstance(started, str)
            else None
        )
        if started_dt is None:
            return
        current_end = self.payload.get("ended_at")
        current_dt = (
            current_end
            if isinstance(current_end, datetime)
            else _parse_datetime(current_end)
            if isinstance(current_end, str)
            else started_dt
        )
        if current_dt is not None and next_end <= current_dt:
            return
        self.payload["ended_at"] = _iso(next_end)
        self.payload["duration_ms"] = max(
            0, int((next_end - started_dt).total_seconds() * 1000)
        )


@dataclass
class TraceContext:
    name: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    input: Any = None
    metadata: dict[str, Any] | None = None
    thread_id: str | None = None
    user_id: str | None = None
    duration_ms: int | None = None
    output_value: Any = None
    error: str | None = None
    spans: list[dict[str, Any]] = field(default_factory=list)

    def output(self, value: Any) -> None:
        self.output_value = value

    def fail(self, error: Any) -> None:
        self.error = _failure_message(error)

    def _debug_span(self, event: str, span: dict[str, Any]) -> None:
        _lemma_debug(
            "client",
            event,
            trace_name=self.name,
            span=_debug_span_summary(span),
        )

    def span(
        self,
        *,
        name: str,
        input: Any = None,
        output: Any = None,
        metadata: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        model: str | None = None,
        tool_name: str | None = None,
        input_mime_type: str | None = None,
        output_mime_type: str | None = None,
        llm_provider: str | None = None,
        llm_invocation_parameters: Any = None,
        llm_input_messages: list[Any] | None = None,
        llm_output_messages: list[Any] | None = None,
        llm_tools: Any = None,
        embedding_model_name: str | None = None,
        embedding_invocation_parameters: Any = None,
        embedding_embeddings: Any = None,
        reranker_model_name: str | None = None,
        reranker_input_documents: list[Any] | None = None,
        reranker_output_documents: list[Any] | None = None,
        started_at: datetime | str | None = None,
        ended_at: datetime | str | None = None,
        duration_ms: int | None = None,
        status: Status | None = None,
        error: Any = None,
        id: str | None = None,
        parent_id: str | None = None,
        type: SpanType = "span",
        usage: dict[str, int | float] | None = None,
        input_tokens: int | float | None = None,
        output_tokens: int | float | None = None,
        cache_read_input_tokens: int | float | None = None,
        cache_creation_input_tokens: int | float | None = None,
        reasoning_output_tokens: int | float | None = None,
        _debug_event: str = "span recorded",
    ) -> None:
        resolved_usage = _resolve_usage(
            usage
            if usage is not None
            else _compact(
                {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": cache_read_input_tokens,
                    "cache_creation_input_tokens": cache_creation_input_tokens,
                    "reasoning_output_tokens": reasoning_output_tokens,
                }
            )
            or None
        )
        span = self._build_span(
            name=name,
            input=input,
            output=output,
            metadata=metadata,
            attributes=attributes,
            model=model,
            tool_name=tool_name,
            input_mime_type=input_mime_type,
            output_mime_type=output_mime_type,
            llm_provider=llm_provider,
            llm_invocation_parameters=llm_invocation_parameters,
            llm_input_messages=llm_input_messages,
            llm_output_messages=llm_output_messages,
            llm_tools=llm_tools,
            embedding_model_name=embedding_model_name,
            embedding_invocation_parameters=embedding_invocation_parameters,
            embedding_embeddings=embedding_embeddings,
            reranker_model_name=reranker_model_name,
            reranker_input_documents=reranker_input_documents,
            reranker_output_documents=reranker_output_documents,
            usage=resolved_usage,
            started_at=started_at,
            ended_at=ended_at,
            duration_ms=duration_ms,
            status=status,
            error=error,
            id=id,
            parent_id=parent_id,
            type=type,
        )
        self.spans.append(span)
        self._debug_span(_debug_event, span)

    def _build_span(
        self,
        *,
        name: str,
        input: Any = None,
        output: Any = None,
        metadata: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        model: str | None = None,
        tool_name: str | None = None,
        user_facing_message: str | None = None,
        input_mime_type: str | None = None,
        output_mime_type: str | None = None,
        llm_provider: str | None = None,
        llm_invocation_parameters: Any = None,
        llm_input_messages: list[Any] | None = None,
        llm_output_messages: list[Any] | None = None,
        llm_tools: Any = None,
        embedding_model_name: str | None = None,
        embedding_invocation_parameters: Any = None,
        embedding_embeddings: Any = None,
        reranker_model_name: str | None = None,
        reranker_input_documents: list[Any] | None = None,
        reranker_output_documents: list[Any] | None = None,
        usage: dict[str, int | float] | None = None,
        started_at: datetime | str | None = None,
        ended_at: datetime | str | None = None,
        duration_ms: int | None = None,
        status: Status | None = None,
        error: Any = None,
        id: str | None = None,
        parent_id: str | None = None,
        type: SpanType = "span",
    ) -> dict[str, Any]:
        started = started_at or _now()
        ended = ended_at or _now()
        resolved_usage = _resolve_usage(usage)
        return _compact(
            {
                "id": id,
                "parent_id": parent_id,
                "name": name,
                "type": type,
                "input": input,
                "output": output,
                "metadata": metadata,
                "attributes": _span_attributes(
                    attributes,
                    model=model,
                    input_mime_type=input_mime_type,
                    output_mime_type=output_mime_type,
                    llm_provider=llm_provider,
                    llm_invocation_parameters=llm_invocation_parameters,
                    llm_input_messages=llm_input_messages,
                    llm_output_messages=llm_output_messages,
                    llm_tools=llm_tools,
                    user_facing_message=user_facing_message,
                    embedding_model_name=embedding_model_name,
                    embedding_invocation_parameters=embedding_invocation_parameters,
                    embedding_embeddings=embedding_embeddings,
                    reranker_model_name=reranker_model_name,
                    reranker_input_documents=reranker_input_documents,
                    reranker_output_documents=reranker_output_documents,
                    usage=resolved_usage,
                ),
                "started_at": _iso(started),
                "ended_at": _iso(ended),
                "duration_ms": duration_ms,
                "status": status or ("ERROR" if error is not None else None),
                "error": _failure_message(error),
                "model": model,
                "tool_name": tool_name,
                "usage": resolved_usage,
            }
        )

    record_span = span

    def generation(
        self,
        *,
        name: str,
        input: Any = None,
        output: Any = None,
        model: str | None = None,
        metadata: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        input_mime_type: str | None = None,
        output_mime_type: str | None = None,
        llm_model_name: str | None = None,
        llm_provider: str | None = None,
        llm_system: str | None = None,
        llm_invocation_parameters: Any = None,
        llm_input_messages: list[Any] | None = None,
        llm_output_messages: list[Any] | None = None,
        llm_tools: Any = None,
        llm_prompt_template: str | None = None,
        llm_prompt_template_variables: Any = None,
        llm_prompt_template_version: str | None = None,
        duration_ms: int | None = None,
        status: Status | None = None,
        error: Any = None,
        usage: dict[str, int | float] | None = None,
        input_tokens: int | float | None = None,
        output_tokens: int | float | None = None,
        cache_read_input_tokens: int | float | None = None,
        cache_creation_input_tokens: int | float | None = None,
        reasoning_output_tokens: int | float | None = None,
    ) -> None:
        now = _now()
        resolved_usage = _resolve_usage(
            usage
            if usage is not None
            else _compact(
                {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": cache_read_input_tokens,
                    "cache_creation_input_tokens": cache_creation_input_tokens,
                    "reasoning_output_tokens": reasoning_output_tokens,
                }
            )
            or None
        )
        span = _compact(
            {
                "name": name,
                "type": "generation",
                "input": input,
                "output": output,
                "model": model,
                "metadata": metadata,
                "attributes": _span_attributes(
                    attributes,
                    model=model,
                    input_mime_type=input_mime_type,
                    output_mime_type=output_mime_type,
                    llm_model_name=llm_model_name,
                    llm_provider=llm_provider,
                    llm_system=llm_system,
                    llm_invocation_parameters=llm_invocation_parameters,
                    llm_input_messages=llm_input_messages,
                    llm_output_messages=llm_output_messages,
                    llm_tools=llm_tools,
                    llm_prompt_template=llm_prompt_template,
                    llm_prompt_template_variables=llm_prompt_template_variables,
                    llm_prompt_template_version=llm_prompt_template_version,
                    usage=resolved_usage,
                ),
                "duration_ms": duration_ms,
                "status": status or ("ERROR" if error is not None else None),
                "error": _failure_message(error),
                "started_at": _iso(now),
                "ended_at": _iso(now),
                "usage": resolved_usage,
            }
        )
        self.spans.append(span)
        self._debug_span("span recorded", span)

    record_generation = generation

    def tool(
        self,
        *,
        name: str,
        input: Any = None,
        output: Any = None,
        metadata: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        input_mime_type: str | None = None,
        output_mime_type: str | None = None,
        tool_description: str | None = None,
        tool_parameters: Any = None,
        user_facing_message: str | None = None,
        duration_ms: int | None = None,
        status: Status | None = None,
        error: Any = None,
    ) -> None:
        now = _now()
        span = _compact(
            {
                "name": name,
                "type": "tool",
                "input": input,
                "output": output,
                "metadata": metadata,
                "attributes": _span_attributes(
                    attributes,
                    input_mime_type=input_mime_type,
                    output_mime_type=output_mime_type,
                    tool_description=tool_description,
                    tool_parameters=tool_parameters,
                    user_facing_message=user_facing_message,
                ),
                "duration_ms": duration_ms,
                "status": status or ("ERROR" if error is not None else None),
                "error": _failure_message(error),
                "started_at": _iso(now),
                "ended_at": _iso(now),
            }
        )
        self.spans.append(span)
        self._debug_span("span recorded", span)

    record_tool = tool

    def start_span(
        self,
        *,
        name: str,
        input: Any = None,
        metadata: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        id: str | None = None,
        parent_id: str | None = None,
        started_at: datetime | str | None = None,
    ) -> SpanHandle:
        handle = SpanHandle(
            trace=self,
            name=name,
            input=input,
            metadata=metadata,
            attributes=attributes,
            id=id or str(uuid.uuid4()),
            parent_id=parent_id,
            started_at=_datetime_or_now(started_at),
        )
        handle.payload = _compact(
            {
                "id": handle.id,
                "parent_id": parent_id,
                "name": name,
                "type": "span",
                "input": input,
                "metadata": metadata,
                "attributes": attributes,
                "started_at": _iso(handle.started_at),
                "ended_at": None,
            }
        )
        self.spans.append(handle.payload)
        self._debug_span(
            "span started",
            handle.payload,
        )
        return handle

    def start_generation(
        self,
        *,
        name: str,
        input: Any = None,
        metadata: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        id: str | None = None,
        parent_id: str | None = None,
        started_at: datetime | str | None = None,
        model: str | None = None,
        llm_provider: str | None = None,
        llm_invocation_parameters: Any = None,
        llm_input_messages: list[Any] | None = None,
        llm_tools: Any = None,
    ) -> SpanHandle:
        handle = SpanHandle(
            trace=self,
            name=name,
            input=input,
            metadata=metadata,
            attributes=attributes,
            type="generation",
            id=id or str(uuid.uuid4()),
            parent_id=parent_id,
            started_at=_datetime_or_now(started_at),
            model=model,
            llm_provider=llm_provider,
            llm_invocation_parameters=llm_invocation_parameters,
            llm_input_messages=llm_input_messages,
            llm_tools=llm_tools,
        )
        handle.payload = _compact(
            {
                "id": handle.id,
                "parent_id": parent_id,
                "name": name,
                "type": "generation",
                "input": input,
                "metadata": metadata,
                "attributes": _span_attributes(
                    attributes,
                    model=model,
                    llm_provider=llm_provider,
                    llm_invocation_parameters=llm_invocation_parameters,
                    llm_input_messages=llm_input_messages,
                    llm_tools=llm_tools,
                ),
                "model": model,
                "started_at": _iso(handle.started_at),
                "ended_at": None,
            }
        )
        self.spans.append(handle.payload)
        self._debug_span(
            "span started",
            handle.payload,
        )
        return handle

    def start_tool(
        self,
        *,
        name: str,
        input: Any = None,
        metadata: dict[str, Any] | None = None,
        attributes: dict[str, Any] | None = None,
        id: str | None = None,
        parent_id: str | None = None,
        started_at: datetime | str | None = None,
        tool_name: str | None = None,
        user_facing_message: str | None = None,
    ) -> SpanHandle:
        handle = SpanHandle(
            trace=self,
            name=name,
            input=input,
            metadata=metadata,
            attributes=attributes,
            type="tool",
            id=id or str(uuid.uuid4()),
            parent_id=parent_id,
            started_at=_datetime_or_now(started_at),
            tool_name=tool_name,
            user_facing_message=user_facing_message,
        )
        handle.payload = _compact(
            {
                "id": handle.id,
                "parent_id": parent_id,
                "name": name,
                "type": "tool",
                "input": input,
                "metadata": metadata,
                "attributes": _span_attributes(
                    attributes, user_facing_message=user_facing_message
                ),
                "tool_name": tool_name,
                "started_at": _iso(handle.started_at),
                "ended_at": None,
            }
        )
        self.spans.append(handle.payload)
        self._debug_span(
            "span started",
            handle.payload,
        )
        return handle

    def payload(
        self,
        project_id: str,
        started_at: datetime,
        ended_at: datetime,
    ) -> dict[str, Any]:
        return {
            "project_id": project_id,
            "trace": {
                "id": self.id,
                "name": self.name,
                "input": self.input,
                "output": self.output_value,
                "metadata": self.metadata,
                "thread_id": self.thread_id,
                "user_id": self.user_id,
                "started_at": _iso(started_at),
                "ended_at": _iso(ended_at),
                "duration_ms": self.duration_ms
                if self.duration_ms is not None
                else _duration_ms(started_at, ended_at),
                "status": "ERROR" if self.error else None,
                "error": self.error,
                "spans": self.spans,
            },
        }


class Lemma:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        project_id: str | None = None,
        release: str | None = None,
        base_url: str = "https://api.uselemma.ai",
        transport: (
            Callable[
                [str, dict[str, str], bytes],
                tuple[int, str] | tuple[int, str, dict[str, str]],
            ]
            | None
        ) = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("LEMMA_API_KEY")
        self.project_id = project_id or os.environ.get("LEMMA_PROJECT_ID")
        if not self.api_key:
            raise ValueError("uselemma-tracing: Missing LEMMA_API_KEY")
        if not self.project_id:
            raise ValueError("uselemma-tracing: Missing LEMMA_PROJECT_ID")
        self.release = normalize_release(
            release if release is not None else os.environ.get("LEMMA_RELEASE")
        )
        self.base_url = base_url.rstrip("/")
        self._last_response_headers: dict[str, str] = {}
        self._config_logged = False
        self._delivery_warning_logged = False
        self.transport = self._wrap_transport(transport or self._urllib_transport)
        self._log_init_config_once()

    def debug_smoke_test(self) -> dict[str, Any]:
        """Run a one-call delivery diagnostic.

        Polls per-trace ``/traces/ingest-status`` after ingest (enqueued /
        ingested / ready), not project-level has-ready.
        """
        config_warnings = build_config_warnings(self.base_url, self.project_id or "")
        hints = list(config_warnings)
        config = {
            "baseUrl": self.base_url,
            "projectId": self.project_id,
            "apiKeySuffix": api_key_suffix(self.api_key or ""),
            "ingestPath": INGEST_PATH,
            "expectedSuccessStatus": EXPECTED_INGEST_SUCCESS_STATUS,
            "warnings": config_warnings,
        }

        trace_id = str(uuid.uuid4())
        ctx = TraceContext(
            id=trace_id,
            name="lemma-debug-smoke-test",
            input="smoke-test",
        )
        ctx.output("ok")
        started_at = _now()
        payload = self._stamp_release(ctx.payload(self.project_id or "", started_at, _now()))
        body = json.dumps(payload, default=str).encode()
        url = f"{self.base_url}{INGEST_PATH}"

        try:
            status, _text = self.transport(
                url,
                {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                body,
            )
        except OSError:
            hints.append("ingest request failed (network error)")
            return {
                "ok": False,
                "config": config,
                "hints": hints,
            }

        response_headers = pick_response_headers(self._last_response_headers)
        ingest_warnings: list[str] = []
        if status != EXPECTED_INGEST_SUCCESS_STATUS:
            ingest_warnings.append(
                f"expected status {EXPECTED_INGEST_SUCCESS_STATUS}, got {status}"
            )
            hint = ingest_failure_hint(status)
            if hint:
                hints.append(hint)
        if "cf-ray" not in response_headers:
            hints.append(
                "missing cf-ray response header (may not be Lemma production)"
            )

        ingest = {
            "status": status,
            "traceId": trace_id,
            "projectId": self.project_id,
            "url": url,
            "responseHeaders": response_headers,
            "warnings": ingest_warnings,
        }

        if status < 200 or status >= 300:
            hints.append(f"ingest failed with status {status}")
            return {
                "ok": False,
                "config": config,
                "ingest": ingest,
                "hints": hints,
            }

        ingest_status = self._poll_ingest_status(trace_id)
        if ingest_status is None:
            hints.append("ingest-status check failed after ingest (status/network)")
        elif not is_successful_ingest_status(ingest_status):
            hints.append(
                "ingest returned 201 but ingest-status=not_found after "
                f"{int(INGEST_STATUS_POLL_TIMEOUT_SECONDS)}s — may be processing lag or downstream issue"
            )

        return {
            "ok": status == EXPECTED_INGEST_SUCCESS_STATUS
            and is_successful_ingest_status(ingest_status),
            "config": config,
            "ingest": ingest,
            "ingestStatus": ingest_status,
            "hints": hints,
        }

    def trace(
        self,
        name: str,
        fn: Callable[[TraceContext], T],
        *,
        input: Any = None,
        thread_id: str | None = None,
        user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        duration_ms: int | None = None,
    ) -> T:
        ctx = TraceContext(
            name=name,
            input=input,
            metadata=metadata,
            thread_id=thread_id,
            user_id=user_id,
            duration_ms=duration_ms,
        )
        started_at = _now()
        _lemma_debug("client", "trace started", name=ctx.name)
        try:
            result = fn(ctx)
        except BaseException as exc:
            # Only the agent's own failure belongs here. Delivery is attempted
            # but never allowed to escape: an ingest error raised from this
            # block would replace ``exc``, and the caller would lose the
            # failure they are handling.
            ctx.fail(exc)
            self._send_without_masking(ctx, started_at, _now())
            raise

        if ctx.output_value is None:
            ctx.output(result)
        # Delivery still raises on a non-2xx so the caller can retry, but it is
        # no longer inside the agent's ``try``: a transport failure must not be
        # recorded as an agent failure, or re-sent as one.
        self._send(ctx, started_at, _now())
        return result

    async def async_trace(
        self,
        name: str,
        fn: Callable[[TraceContext], T],
        *,
        input: Any = None,
        thread_id: str | None = None,
        user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        duration_ms: int | None = None,
    ) -> T:
        ctx = TraceContext(
            name=name,
            input=input,
            metadata=metadata,
            thread_id=thread_id,
            user_id=user_id,
            duration_ms=duration_ms,
        )
        started_at = _now()
        _lemma_debug("client", "trace started", name=ctx.name)
        try:
            maybe_result = fn(ctx)
            result = (
                await maybe_result
                if inspect.isawaitable(maybe_result)
                else maybe_result
            )
        except BaseException as exc:
            ctx.fail(exc)
            self._send_without_masking(ctx, started_at, _now())
            raise

        if ctx.output_value is None:
            ctx.output(result)
        self._send(ctx, started_at, _now())
        return result

    def ingest(
        self,
        context: TraceContext,
        *,
        started_at: datetime,
        ended_at: datetime | None = None,
    ) -> None:
        """Deliver a trace you assembled yourself, in a single request.

        This is the manual counterpart to ``trace``: instead of the client
        owning the lifecycle, you build a ``TraceContext``, record spans,
        output, and status on it, then hand it back to be sent. Use it for
        producers that live outside a single process (cross-process buffers,
        queues, batch backfills) where a long-lived handle can't be held.

        Deliver **one complete trace** when the execution (agent turn)
        finishes: root input/output, thread/user, and all child spans in a
        single call. This is required — patching a trace over time is not
        supported. Omitted root fields do not preserve prior values, and after
        Lemma processes the trace once, a later re-delivery does not re-run
        issue extraction (late new span IDs may still append for display).
        Retries of the same complete payload are safe: already-stored span IDs
        are skipped. Raises on a non-2xx response and never mutates the trace's
        status, so a failed send can be retried as-is.
        """
        self._send(context, started_at, ended_at or _now())

    def _stamp_release(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.release:
            payload["trace"]["release"] = self.release
        return payload

    def _send_without_masking(
        self,
        ctx: TraceContext,
        started_at: datetime,
        ended_at: datetime,
    ) -> None:
        """Deliver a trace without letting a delivery failure replace the caller's error.

        Called only from an ``except`` block that is about to re-raise. If
        :meth:`_send` raised from there, the ingest error would propagate in place
        of the agent's error: ``except MyAgentError`` would stop matching, and the
        original would survive only as ``__context__``.

        Only :class:`Exception` is caught. A ``BaseException`` from the transport
        -- ``KeyboardInterrupt``, ``SystemExit``, ``CancelledError`` -- is left to
        propagate, because suppressing an interrupt to preserve an error message
        is the worse trade.
        """
        try:
            self._send(ctx, started_at, ended_at)
        except Exception as send_error:
            if self._delivery_warning_logged:
                return
            self._delivery_warning_logged = True
            warnings.warn(
                f"uselemma-tracing: could not deliver the trace for a failed run "
                f"({_describe_error(send_error)}); re-raising the original error. "
                f"Further delivery failures on this path are not repeated.",
                RuntimeWarning,
                stacklevel=3,
            )

    def _send(
        self,
        ctx: TraceContext,
        started_at: datetime,
        ended_at: datetime,
    ) -> None:
        payload = self._stamp_release(ctx.payload(self.project_id or "", started_at, ended_at))
        body = json.dumps(payload, default=str).encode()
        url = f"{self.base_url}{INGEST_PATH}"
        _lemma_debug(
            "client",
            "sending trace",
            trace_id=payload["trace"]["id"],
            name=payload["trace"]["name"],
            span_count=len(payload["trace"]["spans"]),
            project_id=payload["project_id"],
            body_bytes=len(body),
            requested_at=_iso(_now()),
            url=url,
        )
        status, text = self.transport(
            url,
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            body,
        )
        response_headers = pick_response_headers(self._last_response_headers)
        if status < 200 or status >= 300:
            hint = ingest_failure_hint(status)
            _lemma_debug(
                "client",
                "trace ingest failed",
                trace_id=payload["trace"]["id"],
                project_id=payload["project_id"],
                status=status,
                body=text,
                **response_headers,
                **({"hint": hint} if hint else {}),
            )
            raise RuntimeError(
                f"uselemma-tracing: failed to ingest trace ({status}): {text}"
            )

        sent_warnings: list[str] = []
        if status != EXPECTED_INGEST_SUCCESS_STATUS:
            sent_warnings.append(
                f"expected status {EXPECTED_INGEST_SUCCESS_STATUS}, got {status} (wrong endpoint?)"
            )
        _lemma_debug(
            "client",
            "trace sent",
            trace_id=payload["trace"]["id"],
            project_id=payload["project_id"],
            status=status,
            **response_headers,
            **({"warnings": sent_warnings} if sent_warnings else {}),
        )
        if is_debug_mode_enabled() and is_debug_verify_enabled():
            otel_trace_id = payload["trace"].get("id")
            if isinstance(otel_trace_id, str) and otel_trace_id:
                self._verify_ingest_delivery(otel_trace_id)

    def _log_init_config_once(self) -> None:
        if not is_debug_mode_enabled() or self._config_logged:
            return
        self._config_logged = True
        warnings = build_config_warnings(self.base_url, self.project_id or "")
        _lemma_debug(
            "client",
            "initialized",
            baseUrl=self.base_url,
            projectId=self.project_id,
            apiKey=api_key_suffix(self.api_key or ""),
            ingestPath=INGEST_PATH,
            expectedSuccessStatus=EXPECTED_INGEST_SUCCESS_STATUS,
            **({"warnings": warnings} if warnings else {}),
        )

    def _wrap_transport(
        self,
        transport: Callable[
            [str, dict[str, str], bytes],
            tuple[int, str] | tuple[int, str, dict[str, str]],
        ],
    ) -> Callable[[str, dict[str, str], bytes], tuple[int, str]]:
        def wrapped(
            url: str, headers: dict[str, str], body: bytes
        ) -> tuple[int, str]:
            result = transport(url, headers, body)
            if len(result) >= 3:
                self._last_response_headers = dict(result[2])
                return result[0], result[1]
            self._last_response_headers = {}
            return result

        return wrapped

    def _fetch_ingest_status(self, otel_trace_id: str) -> str | None:
        url = (
            f"{self.base_url}{INGEST_STATUS_PATH}"
            f"?project_id={urllib.request.quote(self.project_id or '')}"
            f"&otel_trace_id={urllib.request.quote(otel_trace_id)}"
        )
        try:
            status, text, _headers = self._urllib_get(
                url,
                {"Authorization": f"Bearer {self.api_key}"},
            )
            if status < 200 or status >= 300:
                return None
            data = json.loads(text)
            return parse_ingest_status(data.get("status"))
        except (OSError, json.JSONDecodeError, ValueError):
            return None

    def _poll_ingest_status(self, otel_trace_id: str) -> str | None:
        """Poll immediately, then every 1s until success, hard failure, or 15s."""
        deadline = time.monotonic() + INGEST_STATUS_POLL_TIMEOUT_SECONDS
        while True:
            status = self._fetch_ingest_status(otel_trace_id)
            if status is None:
                return None
            if is_successful_ingest_status(status):
                return status
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return status
            time.sleep(min(INGEST_STATUS_POLL_INTERVAL_SECONDS, remaining))

    def _verify_ingest_delivery(self, otel_trace_id: str) -> None:
        result = self._poll_ingest_status(otel_trace_id)
        if result is None:
            _lemma_debug(
                "verify",
                "ingest accepted (201), ingest-status check failed (status/network)",
            )
            return
        if is_successful_ingest_status(result):
            label = "enqueued" if result == "enqueued" else f"visible ({result})"
            _lemma_debug(
                "verify",
                f"ingest accepted (201), trace {label} (status={result})",
            )
            return
        _lemma_debug(
            "verify",
            "ingest accepted (201), ingest-status=not_found after "
            f"{int(INGEST_STATUS_POLL_TIMEOUT_SECONDS)}s — may be processing lag or downstream issue",
        )

    @staticmethod
    def _urllib_transport(
        url: str, headers: dict[str, str], body: bytes
    ) -> tuple[int, str, dict[str, str]]:
        request = urllib.request.Request(
            url,
            data=body,
            headers={"User-Agent": _SDK_USER_AGENT, **headers},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request) as response:
                return (
                    response.status,
                    response.read().decode(),
                    dict(response.headers),
                )
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode(), dict(error.headers)

    @staticmethod
    def _urllib_get(
        url: str, headers: dict[str, str]
    ) -> tuple[int, str, dict[str, str]]:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": _SDK_USER_AGENT, **headers},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request) as response:
                return (
                    response.status,
                    response.read().decode(),
                    dict(response.headers),
                )
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode(), dict(error.headers)
