from __future__ import annotations

from uselemma_tracing.payload import (
    STRUCTURAL_PAYLOAD_KEYS,
    TRUNCATION_MARKER_KEY,
    apply_payload_cap,
    apply_span_content_dedup,
    encoded_size,
)


def _payload(spans, *, input_value="hello"):
    return {
        "project_id": "proj",
        "trace": {
            "id": "trace-1",
            "name": "agent",
            "input": input_value,
            "output": "ok",
            "thread_id": "t1",
            "user_id": "u1",
            "started_at": "2026-01-01T00:00:00Z",
            "ended_at": "2026-01-01T00:00:01Z",
            "duration_ms": 1000,
            "spans": spans,
        },
    }


def test_payload_cap_inserts_explicit_markers_and_keeps_structural_keys():
    huge = "x" * 8000
    payload = _payload(
        [
            {
                "id": "span-1",
                "parent_id": None,
                "name": "hook",
                "type": "span",
                "model": "gpt-4o",
                "tool_name": None,
                "status": "OK",
                "started_at": "2026-01-01T00:00:00Z",
                "ended_at": "2026-01-01T00:00:01Z",
                "duration_ms": 10,
                "input": {"messages": [{"role": "user", "content": huge}]},
                "output": huge,
                "attributes": {
                    "llm.model_name": "gpt-4o",
                    "blob": huge,
                },
            }
        ]
    )

    capped = apply_payload_cap(payload, 2_000)
    span = capped["trace"]["spans"][0]
    assert encoded_size(capped) <= 2_000
    assert span["id"] == "span-1"
    assert span["name"] == "hook"
    assert span["type"] == "span"
    assert span["model"] == "gpt-4o"
    assert span["started_at"] == "2026-01-01T00:00:00Z"
    assert span["input"][TRUNCATION_MARKER_KEY] is True
    assert span["input"]["kind"] == "payload_cap"
    assert span["input"]["original_bytes"] > 8000
    assert span["output"][TRUNCATION_MARKER_KEY] is True
    assert span["attributes"]["llm.model_name"] == "gpt-4o"
    assert span["attributes"]["blob"][TRUNCATION_MARKER_KEY] is True
    assert capped["trace"]["id"] == "trace-1"
    assert capped["trace"]["thread_id"] == "t1"
    for key in (
        "project_id",
        "id",
        "name",
        "type",
        "status",
        "started_at",
        "ended_at",
        "duration_ms",
        "model",
        "thread_id",
        "user_id",
    ):
        assert key in STRUCTURAL_PAYLOAD_KEYS


def test_payload_cap_is_noop_when_already_under_budget():
    payload = _payload([{"id": "s", "name": "n", "input": "tiny"}])
    original = payload["trace"]["spans"][0]["input"]
    assert apply_payload_cap(payload, 50_000)["trace"]["spans"][0]["input"] == original


def test_dedup_replaces_input_identical_to_parent():
    history = [{"role": "user", "content": "x" * 100}]
    payload = _payload(
        [
            {
                "id": "parent",
                "parent_id": None,
                "name": "agent",
                "input": history,
            },
            {
                "id": "child",
                "parent_id": "parent",
                "name": "hook",
                "input": [{"role": "user", "content": "x" * 100}],
                "output": {"rewritten": True},
            },
        ]
    )

    apply_span_content_dedup(payload)
    assert payload["trace"]["spans"][0]["input"] == history
    assert payload["trace"]["spans"][1]["input"] == {
        "__lemma_deduplicated__": True,
        "identical_to": "parent.input",
        "parent_id": "parent",
    }
    assert payload["trace"]["spans"][1]["output"] == {"rewritten": True}


def test_dedup_leaves_distinct_child_input():
    payload = _payload(
        [
            {"id": "parent", "name": "agent", "input": "one"},
            {"id": "child", "parent_id": "parent", "name": "hook", "input": "two"},
        ]
    )
    apply_span_content_dedup(payload)
    assert payload["trace"]["spans"][1]["input"] == "two"


def test_payload_cap_ledger_stays_under_budget_with_many_fields():
    spans = [
        {
            "id": f"span-{index}",
            "name": f"hook-{index}",
            "type": "span",
            "input": {"messages": ["x" * 2000]},
            "output": {"messages": ["y" * 2000]},
        }
        for index in range(20)
    ]
    payload = _payload(spans)
    original = encoded_size(payload)
    capped = apply_payload_cap(payload, 8_000)
    assert encoded_size(capped) <= 8_000
    assert encoded_size(capped) < original // 4
    truncated = sum(
        1
        for span in capped["trace"]["spans"]
        for field in ("input", "output")
        if isinstance(span.get(field), dict) and span[field].get(TRUNCATION_MARKER_KEY)
    )
    assert truncated >= 10
