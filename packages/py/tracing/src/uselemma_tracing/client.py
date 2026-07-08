from __future__ import annotations

import inspect
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Literal, TypeVar

from .debug_delivery import (
    EXPECTED_INGEST_SUCCESS_STATUS,
    INGEST_PATH,
    api_key_suffix,
    build_config_warnings,
    ingest_failure_hint,
    pick_response_headers,
)
from .debug_mode import _lemma_debug, is_debug_mode_enabled, is_debug_verify_enabled

T = TypeVar("T")
SpanType = Literal["span", "generation", "tool"]
Status = Literal["OK", "ERROR"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat().replace("+00:00", "Z")


def _error_message(error: Any) -> str | None:
    if error is None:
        return None
    if isinstance(error, BaseException):
        return str(error)
    return str(error)


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
    embedding_model_name: str | None = None,
    embedding_invocation_parameters: Any = None,
    embedding_embeddings: Any = None,
    reranker_model_name: str | None = None,
    reranker_input_documents: list[Any] | None = None,
    reranker_output_documents: list[Any] | None = None,
) -> dict[str, Any] | None:
    attrs = dict(attributes or {})
    _add_defined(attrs, "input.mime_type", input_mime_type)
    _add_defined(attrs, "output.mime_type", output_mime_type)
    _add_defined(attrs, "llm.model_name", llm_model_name or model)
    _add_defined(attrs, "llm.provider", llm_provider)
    _add_defined(attrs, "llm.system", llm_system)
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
    return attrs or None


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
    payload: dict[str, Any] | None = None
    ended: bool = False

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
    ) -> None:
        if self.ended:
            return
        self.ended = True
        span = self.trace._build_span(
            name=self.name,
            input=self.input,
            output=output,
            metadata=metadata or self.metadata,
            attributes=attributes or self.attributes,
            model=model or self.model,
            tool_name=tool_name or self.tool_name,
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


@dataclass
class TraceContext:
    name: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    input: Any = None
    metadata: dict[str, Any] | None = None
    thread_id: str | None = None
    user_id: str | None = None
    environment: str | None = None
    duration_ms: int | None = None
    output_value: Any = None
    error: str | None = None
    spans: list[dict[str, Any]] = field(default_factory=list)

    def output(self, value: Any) -> None:
        self.output_value = value

    def fail(self, error: Any) -> None:
        self.error = _error_message(error)

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
        _debug_event: str = "span recorded",
    ) -> None:
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
    ) -> dict[str, Any]:
        started = started_at or _now()
        ended = ended_at or _now()
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
                    embedding_model_name=embedding_model_name,
                    embedding_invocation_parameters=embedding_invocation_parameters,
                    embedding_embeddings=embedding_embeddings,
                    reranker_model_name=reranker_model_name,
                    reranker_input_documents=reranker_input_documents,
                    reranker_output_documents=reranker_output_documents,
                ),
                "started_at": _iso(started),
                "ended_at": _iso(ended),
                "duration_ms": duration_ms,
                "status": status or ("ERROR" if error else None),
                "error": _error_message(error),
                "model": model,
                "tool_name": tool_name,
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
    ) -> None:
        now = _now()
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
                ),
                "duration_ms": duration_ms,
                "status": status or ("ERROR" if error else None),
                "error": _error_message(error),
                "started_at": _iso(now),
                "ended_at": _iso(now),
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
                ),
                "duration_ms": duration_ms,
                "status": status or ("ERROR" if error else None),
                "error": _error_message(error),
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
        )
        handle.payload = _compact(
            {
                "id": handle.id,
                "parent_id": parent_id,
                "name": name,
                "type": "tool",
                "input": input,
                "metadata": metadata,
                "attributes": _span_attributes(attributes),
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
        replace: bool = False,
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
                "environment": self.environment,
                "started_at": _iso(started_at),
                "ended_at": _iso(ended_at),
                "duration_ms": self.duration_ms
                if self.duration_ms is not None
                else _duration_ms(started_at, ended_at),
                "status": "ERROR" if self.error else None,
                "error": self.error,
                "spans": self.spans,
            },
            "replace": replace,
        }


class Lemma:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        project_id: str | None = None,
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
        self.base_url = base_url.rstrip("/")
        self._last_response_headers: dict[str, str] = {}
        self._config_logged = False
        self.transport = self._wrap_transport(transport or self._urllib_transport)
        self._log_init_config_once()

    def debug_smoke_test(self) -> dict[str, Any]:
        """Run a one-call delivery diagnostic.

        ``hasReadyBefore`` / ``hasReadyAfter`` reflect whether the project has
        any ready traces (not whether this specific smoke trace is queryable).
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

        has_ready_before = self._fetch_has_ready_traces()
        if has_ready_before is None:
            hints.append("has-ready check failed before ingest (status/network)")

        trace_id = str(uuid.uuid4())
        ctx = TraceContext(
            id=trace_id,
            name="lemma-debug-smoke-test",
            input="smoke-test",
        )
        ctx.output("ok")
        started_at = _now()
        payload = ctx.payload(self.project_id or "", started_at, _now(), False)
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
                "hasReadyBefore": has_ready_before,
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
                "hasReadyBefore": has_ready_before,
                "hints": hints,
            }

        has_ready_after = self._poll_has_ready_traces()
        if has_ready_after is None:
            hints.append("has-ready check failed after ingest (status/network)")
        elif not has_ready_after:
            hints.append(
                "ingest returned 201 but has_ready_traces=false — may be processing lag or downstream issue"
            )

        return {
            "ok": status == EXPECTED_INGEST_SUCCESS_STATUS and has_ready_after is True,
            "config": config,
            "ingest": ingest,
            "hasReadyBefore": has_ready_before,
            "hasReadyAfter": has_ready_after,
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
        environment: str | None = None,
        duration_ms: int | None = None,
    ) -> T:
        ctx = TraceContext(
            name=name,
            input=input,
            metadata=metadata,
            thread_id=thread_id,
            user_id=user_id,
            environment=environment,
            duration_ms=duration_ms,
        )
        started_at = _now()
        _lemma_debug("client", "trace started", name=ctx.name)
        try:
            result = fn(ctx)
            if ctx.output_value is None:
                ctx.output(result)
            self._send(ctx, started_at, _now())
            return result
        except BaseException as exc:
            ctx.fail(exc)
            self._send(ctx, started_at, _now())
            raise

    async def async_trace(
        self,
        name: str,
        fn: Callable[[TraceContext], T],
        *,
        input: Any = None,
        thread_id: str | None = None,
        user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        environment: str | None = None,
        duration_ms: int | None = None,
    ) -> T:
        ctx = TraceContext(
            name=name,
            input=input,
            metadata=metadata,
            thread_id=thread_id,
            user_id=user_id,
            environment=environment,
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
            if ctx.output_value is None:
                ctx.output(result)
            self._send(ctx, started_at, _now())
            return result
        except BaseException as exc:
            ctx.fail(exc)
            self._send(ctx, started_at, _now())
            raise

    def ingest(
        self,
        context: TraceContext,
        *,
        started_at: datetime,
        ended_at: datetime | None = None,
        replace: bool = False,
    ) -> None:
        """Deliver a trace you assembled yourself, in a single request.

        This is the manual counterpart to ``trace``: instead of the client
        owning the lifecycle, you build a ``TraceContext``, record spans,
        output, and status on it, then hand it back to be sent. Use it for
        producers that live outside a single process (cross-process buffers,
        queues, batch backfills) where a long-lived handle can't be held.

        Spans merge into the trace by id when ``replace`` is ``False`` (the
        default), so a trace can be sent incrementally across several calls
        under one stable id; pass ``replace=True`` to overwrite it wholesale.
        Raises on a non-2xx response and never mutates the trace's status, so a
        failed send can be retried as-is.
        """
        self._send(context, started_at, ended_at or _now(), replace)

    def _send(
        self,
        ctx: TraceContext,
        started_at: datetime,
        ended_at: datetime,
        replace: bool = False,
    ) -> None:
        payload = ctx.payload(self.project_id or "", started_at, ended_at, replace)
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
            replace=replace,
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
            self._verify_ingest_delivery()

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

    def _fetch_has_ready_traces(self) -> bool | None:
        url = (
            f"{self.base_url}/traces/has-ready"
            f"?project_id={urllib.request.quote(self.project_id or '')}"
        )
        try:
            status, text, _headers = self._urllib_get(
                url,
                {"Authorization": f"Bearer {self.api_key}"},
            )
            if status < 200 or status >= 300:
                return None
            data = json.loads(text)
            return bool(data.get("has_ready_traces", data.get("hasReadyTraces")))
        except (OSError, json.JSONDecodeError, ValueError):
            return None

    def _poll_has_ready_traces(self) -> bool | None:
        """Poll immediately; if false, wait briefly and retry once."""
        first = self._fetch_has_ready_traces()
        if first is not False:
            return first
        time.sleep(5)
        return self._fetch_has_ready_traces()

    def _verify_ingest_delivery(self) -> None:
        result = self._poll_has_ready_traces()
        if result is None:
            _lemma_debug(
                "verify",
                "ingest accepted (201), has-ready check failed (status/network)",
            )
            return
        if result:
            _lemma_debug(
                "verify",
                "ingest accepted (201), traces visible in dashboard",
            )
            return
        _lemma_debug(
            "verify",
            "ingest accepted (201), but has_ready_traces=false — may be processing lag or downstream issue",
        )

    @staticmethod
    def _urllib_transport(
        url: str, headers: dict[str, str], body: bytes
    ) -> tuple[int, str, dict[str, str]]:
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
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
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request) as response:
                return (
                    response.status,
                    response.read().decode(),
                    dict(response.headers),
                )
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode(), dict(error.headers)
