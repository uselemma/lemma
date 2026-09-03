from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from .client import Lemma, TraceContext, TraceHandle, _datetime_or_now, _iso, _now

TURN_CONTEXT_VERSION = 1
TURN_JOURNAL_VERSION = 1

_RECORD_KEYS = (
    "id",
    "parentId",
    "name",
    "type",
    "input",
    "output",
    "metadata",
    "attributes",
    "startedAt",
    "endedAt",
    "durationMs",
    "status",
    "error",
    "model",
    "toolName",
    "usage",
    "userFacingMessage",
    "llmProvider",
    "llmModelName",
    "llmInputMessages",
    "llmOutputMessages",
    "llmInvocationParameters",
    "llmTools",
)


def _compact(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def parse_turn_context_token(value: str | dict[str, Any]) -> dict[str, Any]:
    token = json.loads(value) if isinstance(value, str) else value
    if (
        not isinstance(token, dict)
        or token.get("version") != TURN_CONTEXT_VERSION
        or not isinstance(token.get("traceId"), str)
        or not token["traceId"]
        or not isinstance(token.get("startedAt"), str)
        or not token["startedAt"]
    ):
        raise ValueError("uselemma-tracing: invalid turn context token")
    return token


def _parse_journal(value: Any) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    parsed = json.loads(value) if isinstance(value, str) else value
    if isinstance(parsed, list):
        return None, parsed
    if isinstance(parsed, dict) and "op" in parsed:
        return None, [parsed]
    if isinstance(parsed, dict) and isinstance(parsed.get("records"), list):
        if (
            parsed.get("version") is not None
            and parsed.get("version") != TURN_JOURNAL_VERSION
        ):
            raise ValueError(
                f"uselemma-tracing: unsupported turn journal version {parsed.get('version')}"
            )
        token = parsed.get("token")
        return token if isinstance(token, dict) else None, parsed["records"]
    raise ValueError("uselemma-tracing: invalid turn journal")


def _span_kwargs(record: dict[str, Any], fallback_parent_id: str | None) -> dict[str, Any]:
    return _compact(
        {
            "id": record.get("id"),
            "parent_id": record.get("parentId", fallback_parent_id),
            "name": record.get("name") or "span",
            "type": record.get("type") or "span",
            "input": record.get("input"),
            "output": record.get("output"),
            "metadata": record.get("metadata"),
            "attributes": record.get("attributes"),
            "started_at": record.get("startedAt"),
            "ended_at": record.get("endedAt"),
            "duration_ms": record.get("durationMs"),
            "status": record.get("status"),
            "error": record.get("error"),
            "model": record.get("model"),
            "tool_name": record.get("toolName"),
            "usage": record.get("usage"),
            "user_facing_message": record.get("userFacingMessage"),
            "llm_provider": record.get("llmProvider"),
            "llm_model_name": record.get("llmModelName"),
            "llm_input_messages": record.get("llmInputMessages"),
            "llm_output_messages": record.get("llmOutputMessages"),
            "llm_invocation_parameters": record.get("llmInvocationParameters"),
            "llm_tools": record.get("llmTools"),
        }
    )


_START_SPAN_KEYS = {
    "name",
    "input",
    "metadata",
    "attributes",
    "id",
    "parent_id",
    "started_at",
}
_START_GENERATION_KEYS = _START_SPAN_KEYS | {
    "model",
    "llm_provider",
    "llm_invocation_parameters",
    "llm_input_messages",
    "llm_tools",
}
_START_TOOL_KEYS = _START_SPAN_KEYS | {"tool_name", "user_facing_message"}
_END_KEYS = {
    "output",
    "duration_ms",
    "status",
    "error",
    "ended_at",
    "metadata",
    "attributes",
    "model",
    "tool_name",
    "llm_provider",
    "llm_invocation_parameters",
    "llm_output_messages",
    "usage",
    "input_tokens",
    "output_tokens",
}


def _pick(kwargs: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
    return {key: value for key, value in kwargs.items() if key in allowed}


def _start_from_record(context: TraceContext, kwargs: dict[str, Any]) -> SpanHandle:
    span_type = kwargs.get("type") or "span"
    if span_type == "generation":
        return context.start_generation(**_pick(kwargs, _START_GENERATION_KEYS))
    if span_type == "tool":
        return context.start_tool(**_pick(kwargs, _START_TOOL_KEYS))
    return context.start_span(**_pick(kwargs, _START_SPAN_KEYS))


def _record_from_record(context: TraceContext, kwargs: dict[str, Any]) -> None:
    context.span(**kwargs)


def apply_turn_journal(context: TraceContext, value: Any) -> None:
    token, records = _parse_journal(value)
    fallback_parent = token.get("parentSpanId") if token else None
    for record in records:
        if not isinstance(record, dict) or not record.get("id") or not record.get("op"):
            continue
        kwargs = _span_kwargs(record, fallback_parent)
        op = record["op"]
        span_id = record["id"]
        if op == "start":
            if context.has_span(span_id):
                continue
            _start_from_record(context, dict(kwargs))
            continue
        if op == "end":
            handle = context.span_handle(span_id)
            if handle is not None:
                handle.end(
                    **_pick(
                        _compact(
                            {
                                "output": record.get("output"),
                                "metadata": record.get("metadata"),
                                "attributes": record.get("attributes"),
                                "ended_at": record.get("endedAt"),
                                "duration_ms": record.get("durationMs"),
                                "status": record.get("status"),
                                "error": record.get("error"),
                                "model": record.get("model"),
                                "tool_name": record.get("toolName"),
                                "usage": record.get("usage"),
                                "llm_provider": record.get("llmProvider"),
                                "llm_output_messages": record.get("llmOutputMessages"),
                                "llm_invocation_parameters": record.get(
                                    "llmInvocationParameters"
                                ),
                            }
                        ),
                        _END_KEYS,
                    )
                )
                continue
            if context.has_span(span_id):
                continue
            _record_from_record(context, kwargs)
            continue
        if context.has_span(span_id):
            continue
        _record_from_record(context, kwargs)


def assemble_turn(
    token: str | dict[str, Any],
    journal: Any = None,
    *,
    name: str | None = None,
    input: Any = None,
    output: Any = None,
    metadata: dict[str, Any] | None = None,
    thread_id: str | None = None,
    user_id: str | None = None,
    duration_ms: int | None = None,
) -> tuple[TraceContext, datetime]:
    parsed = parse_turn_context_token(token)
    started_at = _datetime_or_now(parsed["startedAt"])
    context = TraceContext(
        id=parsed["traceId"],
        name=name or parsed.get("name") or "trace",
        input=input,
        metadata=metadata,
        thread_id=thread_id or parsed.get("threadId"),
        user_id=user_id or parsed.get("userId"),
        duration_ms=duration_ms,
    )
    if output is not None:
        context.output(output)
    if journal is not None:
        apply_turn_journal(context, journal)
    return context, started_at


def _record_fields(
    *,
    op: str,
    span_type: str,
    fallback_parent_id: str | None,
    **kwargs: Any,
) -> dict[str, Any]:
    started = kwargs.get("started_at")
    ended = kwargs.get("ended_at")
    record = _compact(
        {
            "op": op,
            "id": kwargs.get("id") or str(uuid.uuid4()),
            "parentId": kwargs.get("parent_id", fallback_parent_id),
            "name": kwargs.get("name"),
            "type": span_type,
            "input": kwargs.get("input"),
            "output": kwargs.get("output"),
            "metadata": kwargs.get("metadata"),
            "attributes": kwargs.get("attributes"),
            "startedAt": _iso(started) if started is not None else None,
            "endedAt": _iso(ended) if ended is not None else None,
            "durationMs": kwargs.get("duration_ms"),
            "status": kwargs.get("status"),
            "error": kwargs.get("error"),
            "model": kwargs.get("model"),
            "toolName": kwargs.get("tool_name"),
            "usage": kwargs.get("usage"),
            "userFacingMessage": kwargs.get("user_facing_message"),
            "llmProvider": kwargs.get("llm_provider"),
            "llmModelName": kwargs.get("llm_model_name"),
            "llmInputMessages": kwargs.get("llm_input_messages"),
            "llmOutputMessages": kwargs.get("llm_output_messages"),
            "llmInvocationParameters": kwargs.get("llm_invocation_parameters"),
            "llmTools": kwargs.get("llm_tools"),
        }
    )
    return {key: record[key] for key in ("op", *_RECORD_KEYS) if key in record}


class AttachedSpanHandle:
    def __init__(self, recorder: AttachedTurn, record: dict[str, Any]) -> None:
        self._recorder = recorder
        self._record = record
        self.id = record["id"]
        self._ended = record.get("op") != "start"

    def end(self, **kwargs: Any) -> None:
        if self._ended:
            return
        self._ended = True
        fields = {
            "id": self.id,
            "name": self._record.get("name"),
            "parent_id": self._record.get("parentId"),
            "input": self._record.get("input"),
            "model": self._record.get("model"),
            "tool_name": self._record.get("toolName"),
            **kwargs,
        }
        if "ended_at" not in kwargs:
            fields["ended_at"] = _now()
        self._recorder.append(
            _record_fields(
                op="end",
                span_type=self._record.get("type") or "span",
                fallback_parent_id=self._record.get("parentId"),
                **fields,
            )
        )

    def start_span(self, **kwargs: Any) -> AttachedSpanHandle:
        kwargs.setdefault("parent_id", self.id)
        return self._recorder.start_span(**kwargs)

    def start_generation(self, **kwargs: Any) -> AttachedSpanHandle:
        kwargs.setdefault("parent_id", self.id)
        return self._recorder.start_generation(**kwargs)

    def start_tool(self, **kwargs: Any) -> AttachedSpanHandle:
        kwargs.setdefault("parent_id", self.id)
        return self._recorder.start_tool(**kwargs)

    def record_span(self, **kwargs: Any) -> None:
        kwargs.setdefault("parent_id", self.id)
        self._recorder.record_span(**kwargs)

    def record_generation(self, **kwargs: Any) -> None:
        kwargs.setdefault("parent_id", self.id)
        self._recorder.record_generation(**kwargs)

    def record_tool(self, **kwargs: Any) -> None:
        kwargs.setdefault("parent_id", self.id)
        self._recorder.record_tool(**kwargs)


class AttachedTurn:
    def __init__(self, token: str | dict[str, Any]) -> None:
        self.token = parse_turn_context_token(token)
        self._records: list[dict[str, Any]] = []

    @property
    def id(self) -> str:
        return self.token["traceId"]

    def append(self, record: dict[str, Any]) -> None:
        self._records.append(record)

    def records(self) -> dict[str, Any]:
        return {
            "version": TURN_JOURNAL_VERSION,
            "token": self.token,
            "records": list(self._records),
        }

    def start_span(self, **kwargs: Any) -> AttachedSpanHandle:
        return self._start("span", kwargs)

    def start_generation(self, **kwargs: Any) -> AttachedSpanHandle:
        return self._start("generation", kwargs)

    def start_tool(self, **kwargs: Any) -> AttachedSpanHandle:
        return self._start("tool", kwargs)

    def record_span(self, **kwargs: Any) -> None:
        self._record("span", kwargs)

    def record_generation(self, **kwargs: Any) -> None:
        self._record("generation", kwargs)

    def record_tool(self, **kwargs: Any) -> None:
        self._record("tool", kwargs)

    def _start(self, span_type: str, kwargs: dict[str, Any]) -> AttachedSpanHandle:
        kwargs = dict(kwargs)
        kwargs.setdefault("id", str(uuid.uuid4()))
        kwargs.setdefault("started_at", _now())
        kwargs.setdefault("parent_id", self.token.get("parentSpanId"))
        record = _record_fields(
            op="start",
            span_type=span_type,
            fallback_parent_id=self.token.get("parentSpanId"),
            **kwargs,
        )
        self.append(record)
        return AttachedSpanHandle(self, record)

    def _record(self, span_type: str, kwargs: dict[str, Any]) -> None:
        kwargs = dict(kwargs)
        kwargs.setdefault("id", str(uuid.uuid4()))
        now = _now()
        kwargs.setdefault("started_at", now)
        if "ended_at" not in kwargs:
            kwargs["ended_at"] = now
        kwargs.setdefault("parent_id", self.token.get("parentSpanId"))
        self.append(
            _record_fields(
                op="record",
                span_type=span_type,
                fallback_parent_id=self.token.get("parentSpanId"),
                **kwargs,
            )
        )


class TurnHandle(TraceHandle):
    def export(self, parent_span_id: str | None = None) -> dict[str, Any]:
        return _compact(
            {
                "version": TURN_CONTEXT_VERSION,
                "traceId": self.id,
                "parentSpanId": parent_span_id,
                "threadId": self.thread_id,
                "userId": self.user_id,
                "startedAt": _iso(self.started_at),
                "name": self.name,
            }
        )

    def apply(self, journal: Any) -> None:
        apply_turn_journal(self, journal)


def start_turn(lemma: Lemma, **kwargs: Any) -> TurnHandle:
    return TurnHandle(lemma, **kwargs)


def attach_turn(token: str | dict[str, Any]) -> AttachedTurn:
    return AttachedTurn(token)
