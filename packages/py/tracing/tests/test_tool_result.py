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


def test_tool_result_error_string_error_field():
    assert (
        tool_result_error({"error": "Error: Payment method not found"})
        == "Error: Payment method not found"
    )
    assert tool_result_error({"error": ""}) is None
    assert tool_result_error({"error": None}) is None


def test_tool_result_error_mcp_structured_content_error():
    assert (
        tool_result_error(
            {
                "isError": False,
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps({"error": "Error: Payment method not found"}),
                    }
                ],
                "structuredContent": {"error": "Error: Payment method not found"},
            }
        )
        == "Error: Payment method not found"
    )


def test_tool_result_error_parses_error_object_from_content_text():
    assert (
        tool_result_error(
            {
                "isError": False,
                "content": [
                    {
                        "type": "text",
                        "text": '{"error":"Error: Payment method should be the original payment method"}',
                    }
                ],
            }
        )
        == "Error: Payment method should be the original payment method"
    )
