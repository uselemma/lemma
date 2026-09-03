from __future__ import annotations

import inspect
import json
import uuid
from datetime import datetime
from typing import Any

from .client import Lemma, TraceContext, TraceHandle, _datetime_or_now, _iso, _now

TURN_CONTEXT_VERSION = 1
TURN_JOURNAL_VERSION = 1

def _journal_key(span_key: str) -> str:
    head, *rest = span_key.split("_")
    return head + "".join(part.title() for part in rest)


_SKIP_SPAN_PARAMS = {"self", "open_span"}


def _journal_span_fields() -> tuple[tuple[str, str], ...]:
    """camelCase journal key -> TraceContext._build_span kwargs.

    Derived from the span payload surface so Python replay tracks TS
    ``TurnJournalSpan = SpanOptions`` when new fields are added.
    """
    return tuple(
        (_journal_key(name), name)
        for name in inspect.signature(TraceContext._build_span).parameters
        if name not in _SKIP_SPAN_PARAMS
    )


_JOURNAL_SPAN_FIELDS = _journal_span_fields()
_SPAN_TO_JOURNAL = {
    span_key: journal_key for journal_key, span_key in _JOURNAL_SPAN_FIELDS
}


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
    kwargs: dict[str, Any] = {}
    for journal_key, span_key in _JOURNAL_SPAN_FIELDS:
        if journal_key == "parentId":
            kwargs[span_key] = record.get("parentId", fallback_parent_id)
            continue
        if journal_key in record:
            kwargs[span_key] = record[journal_key]
    if not kwargs.get("name"):
        kwargs["name"] = "span"
    if not kwargs.get("type"):
        kwargs["type"] = "span"
    return _compact(kwargs)


_END_IDENTITY_KEYS = {"id", "name", "type", "started_at", "parent_id"}


def _start_from_record(context: TraceContext, kwargs: dict[str, Any]) -> None:
    context._open_span(**kwargs)


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
                    **{
                        key: value
                        for key, value in kwargs.items()
                        if key not in _END_IDENTITY_KEYS
                    }
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
    values = dict(kwargs)
    values["id"] = kwargs.get("id") or str(uuid.uuid4())
    values["parent_id"] = kwargs.get("parent_id", fallback_parent_id)
    values["type"] = span_type
    values["started_at"] = _iso(started) if started is not None else None
    values["ended_at"] = _iso(ended) if ended is not None else None
    record: dict[str, Any] = {"op": op}
    for span_key, journal_key in _SPAN_TO_JOURNAL.items():
        if span_key in values and values[span_key] is not None:
            record[journal_key] = values[span_key]
    return record


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
        fields = _span_kwargs(self._record, self._record.get("parentId"))
        fields.update(kwargs)
        fields["id"] = self.id
        if "ended_at" not in kwargs:
            fields["ended_at"] = _now()
        self._recorder.append(
            _record_fields(
                op="end",
                span_type=self._record.get("type") or fields.get("type") or "span",
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
