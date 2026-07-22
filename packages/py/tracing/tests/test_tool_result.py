from __future__ import annotations

import json

from uselemma_tracing.tool_result import tool_result_error


def test_tool_result_error_returns_none_for_success():
    assert tool_result_error({"content": [{"text": "ok", "type": "text"}]}) is None
    assert tool_result_error({"isError": False, "content": []}) is None
    assert tool_result_error("plain text") is None
    assert tool_result_error({"error": False, "message": "ignored"}) is None


def test_tool_result_error_extracts_mcp_is_error_content():
    assert (
        tool_result_error(
            {
                "isError": True,
                "content": [
                    {"type": "text", "text": "Internal error: Validation error"},
                ],
            }
        )
        == "Internal error: Validation error"
    )


def test_tool_result_error_parses_json_string_payloads():
    assert (
        tool_result_error(
            json.dumps(
                {
                    "isError": True,
                    "content": [{"type": "text", "text": "boom"}],
                }
            )
        )
        == "boom"
    )


def test_tool_result_error_mastra_error_true_payload():
    assert (
        tool_result_error(
            {
                "error": True,
                "message": "Tool input validation failed for ship",
                "validationErrors": {"errors": [], "fields": {}},
            }
        )
        == "Tool input validation failed for ship"
    )
