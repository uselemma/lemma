from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from uselemma_tracing import Lemma, attach_turn, assemble_turn, parse_turn_context_token, TraceHandle
from uselemma_tracing.turn import apply_turn_journal

PROJECT_ID = "10000000-0000-0000-0000-000000000001"


def _host(calls, status=201):
    def transport(_url, _headers, body):
        calls.append(json.loads(body.decode()))
        return status, "nope" if status != 201 else "{}"

    return Lemma(api_key="key", project_id=PROJECT_ID, transport=transport)


def test_host_and_child_produce_one_ingest_payload():
    calls = []
    host = _host(calls)
    turn = host.start_turn(
        "agent-turn",
        id="trace-1",
        input="fix the bug",
        thread_id="thread-1",
        user_id="user-1",
        started_at="2026-09-03T00:00:00.000Z",
    )
    sandbox = turn.start_span(
        name="e2b-sandbox",
        id="sandbox-1",
        started_at="2026-09-03T00:00:00.500Z",
    )
    token = json.dumps(turn.export(parent_span_id=sandbox.id))

    local = attach_turn(token)
    local.record_tool(
        id="tool-1",
        name="search",
        input={"q": "bug"},
        output={"hits": 1},
        started_at="2026-09-03T00:00:01.000Z",
        ended_at="2026-09-03T00:00:02.000Z",
    )
    gen = local.start_generation(
        id="gen-1",
        name="answer",
        model="gpt-4o",
        started_at="2026-09-03T00:00:02.000Z",
    )
    gen.end(output="patched", ended_at="2026-09-03T00:00:03.000Z")

    assert calls == []
    turn.apply(json.dumps(local.records()))
    sandbox.end(output={"ok": True}, ended_at="2026-09-03T00:00:03.500Z")
    turn.end(output="patched", ended_at="2026-09-03T00:00:04.000Z")

    assert len(calls) == 1
    trace = calls[0]["trace"]
    assert trace["id"] == "trace-1"
    assert trace["name"] == "agent-turn"
    assert trace["thread_id"] == "thread-1"
    assert trace["user_id"] == "user-1"
    assert trace["input"] == "fix the bug"
    assert trace["output"] == "patched"
    by_id = {span["id"]: span for span in trace["spans"]}
    assert by_id["sandbox-1"]["type"] == "span"
    assert by_id["tool-1"]["type"] == "tool"
    assert by_id["tool-1"]["parent_id"] == "sandbox-1"
    assert by_id["tool-1"]["output"] == {"hits": 1}
    assert by_id["gen-1"]["type"] == "generation"
    assert by_id["gen-1"]["parent_id"] == "sandbox-1"
    assert by_id["gen-1"]["output"] == "patched"


def test_attach_turn_does_not_require_api_key():
    local = attach_turn(
        {
            "version": 1,
            "traceId": "trace-1",
            "parentSpanId": "sandbox-1",
            "startedAt": "2026-09-03T00:00:00.000Z",
        }
    )
    local.record_span(name="work", output="done")
    journal = local.records()
    assert journal["token"]["traceId"] == "trace-1"
    assert len(journal["records"]) == 1


def test_reapplying_journal_does_not_duplicate_spans():
    calls = []
    host = _host(calls)
    turn = host.start_turn("agent-turn", id="trace-1")
    sandbox = turn.start_span(name="e2b-sandbox", id="sandbox-1")
    local = attach_turn(turn.export(parent_span_id=sandbox.id))
    local.record_tool(id="tool-1", name="search", output={"hits": 1})
    journal = local.records()
    turn.apply(journal)
    turn.apply(journal)
    turn.apply(json.dumps(journal))
    sandbox.end()
    turn.end(output="ok")
    ids = [span["id"] for span in calls[0]["trace"]["spans"]]
    assert ids.count("tool-1") == 1
    assert ids.count("sandbox-1") == 1


def test_retried_assemble_keeps_stable_ids():
    calls = []
    host = _host(calls)
    token = {
        "version": 1,
        "traceId": "trace-1",
        "parentSpanId": "sandbox-1",
        "threadId": "thread-1",
        "startedAt": "2026-09-03T00:00:00.000Z",
        "name": "agent-turn",
    }
    local = attach_turn(token)
    local.record_tool(id="tool-1", name="search", output={"hits": 1})
    journal = local.records()
    started = datetime(2026, 9, 3, tzinfo=timezone.utc)
    ended = datetime(2026, 9, 3, 0, 0, 4, tzinfo=timezone.utc)
    for _ in range(2):
        context, started_at = assemble_turn(
            token,
            journal,
            name="agent-turn",
            input="fix",
            output="done",
        )
        context.record_span(
            id="sandbox-1",
            name="e2b-sandbox",
            started_at=token["startedAt"],
            ended_at="2026-09-03T00:00:04.000Z",
        )
        apply_turn_journal(context, journal)
        host.ingest(context, started_at=started_at, ended_at=ended)
    assert len(calls) == 2
    first = [span["id"] for span in calls[0]["trace"]["spans"]]
    second = [span["id"] for span in calls[1]["trace"]["spans"]]
    assert first == second
    assert "tool-1" in first
    assert started_at == started or started_at.year == 2026


def test_unclean_child_exit_allows_incomplete_tools_and_host_error():
    calls = []
    host = _host(calls)
    turn = host.start_turn("agent-turn", id="trace-1")
    sandbox = turn.start_span(name="e2b-sandbox", id="sandbox-1")
    local = attach_turn(turn.export(parent_span_id=sandbox.id))
    local.start_tool(
        id="tool-open",
        name="edit_file",
        input={"path": "app.ts"},
        started_at="2026-09-03T00:00:01.000Z",
    )
    turn.apply(local.records())
    sandbox.end(status="ERROR", error="sandbox killed")
    turn.fail("sandbox exited uncleanly")
    turn.end()
    trace = calls[0]["trace"]
    assert trace["status"] == "ERROR"
    assert trace["error"] == "sandbox exited uncleanly"
    by_id = {span["id"]: span for span in trace["spans"]}
    assert by_id["sandbox-1"]["status"] == "ERROR"
    assert by_id["tool-open"]["type"] == "tool"
    assert by_id["tool-open"]["parent_id"] == "sandbox-1"
    assert by_id["tool-open"].get("ended_at") in (None, )


def test_turn_end_stays_strict():
    host = _host([], status=503)
    turn = host.start_turn("agent-turn")
    with pytest.raises(RuntimeError, match="failed to ingest trace"):
        turn.end(output="ok")


def test_turn_handle_extends_trace_handle():
    turn = _host([]).start_turn("agent-turn")
    assert isinstance(turn, TraceHandle)


def test_parse_turn_context_token_rejects_invalid():
    token = parse_turn_context_token(
        {
            "version": 1,
            "traceId": "trace-1",
            "startedAt": "2026-09-03T00:00:00.000Z",
            "parentSpanId": "sandbox-1",
        }
    )
    assert token["traceId"] == "trace-1"
    with pytest.raises(ValueError, match="invalid turn context token"):
        parse_turn_context_token("{}")


def test_apply_start_end_preserves_llm_and_tool_journal_fields():
    calls = []
    host = _host(calls)
    turn = host.start_turn("agent-turn", id="trace-1")
    turn.apply(
        {
            "version": 1,
            "token": {
                "version": 1,
                "traceId": "trace-1",
                "parentSpanId": "sandbox-1",
                "startedAt": "2026-09-03T00:00:00.000Z",
            },
            "records": [
                {
                    "op": "start",
                    "id": "gen-1",
                    "parentId": "sandbox-1",
                    "name": "answer",
                    "type": "generation",
                    "model": "gpt-4o",
                    "llmModelName": "gpt-4o-mini",
                    "llmSystem": "openai",
                    "llmPromptTemplate": "Say {x}",
                    "llmPromptTemplateVariables": {"x": "hi"},
                    "llmPromptTemplateVersion": "1",
                    "embeddingModelName": "text-embedding-3",
                    "startedAt": "2026-09-03T00:00:01.000Z",
                },
                {
                    "op": "end",
                    "id": "gen-1",
                    "input": "Say hi",
                    "inputMimeType": "text/plain",
                    "output": "hello",
                    "llmModelName": "gpt-4o-mini",
                    "endedAt": "2026-09-03T00:00:02.000Z",
                },
                {
                    "op": "start",
                    "id": "tool-1",
                    "parentId": "sandbox-1",
                    "name": "search",
                    "type": "tool",
                    "userFacingMessage": "Looking it up",
                    "startedAt": "2026-09-03T00:00:02.000Z",
                },
                {
                    "op": "end",
                    "id": "tool-1",
                    "output": {"hits": 1},
                    "userFacingMessage": "Looking it up",
                    "endedAt": "2026-09-03T00:00:03.000Z",
                },
            ],
        }
    )
    turn.end(output="ok")
    by_id = {span["id"]: span for span in calls[0]["trace"]["spans"]}
    gen_attrs = by_id["gen-1"]["attributes"]
    assert gen_attrs["llm.model_name"] == "gpt-4o-mini"
    assert gen_attrs["llm.system"] == "openai"
    assert gen_attrs["llm.prompt_template.template"] == "Say {x}"
    assert gen_attrs["llm.prompt_template.version"] == "1"
    assert gen_attrs["input.mime_type"] == "text/plain"
    assert gen_attrs["embedding.model_name"] == "text-embedding-3"
    assert by_id["tool-1"]["attributes"]["lemma.tool.message"] == "Looking it up"
    assert by_id["gen-1"]["input"] == "Say hi"
    assert by_id["gen-1"]["output"] == "hello"
