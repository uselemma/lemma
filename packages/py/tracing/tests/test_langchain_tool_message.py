from __future__ import annotations

import asyncio

import pytest
from langchain_core.messages import ToolMessage
from langchain_core.tools import ToolException, tool

from helpers import PROJECT_ID, make_transport
from uselemma_tracing import langchain


@pytest.mark.parametrize("async_call", [False, True])
@pytest.mark.parametrize("validation_error", [False, True])
def test_handled_tool_failure_is_recorded_as_error(async_call, validation_error):
    calls = []
    handler = langchain(
        api_key="key", project_id=PROJECT_ID, transport=make_transport(calls)
    )

    @tool
    def lookup_order(order_id: str) -> str:
        """Look up an order."""
        raise ToolException("Order service unavailable")

    lookup_order.handle_tool_error = True
    lookup_order.handle_validation_error = True
    expected = (
        "Tool input validation error" if validation_error else "Order service unavailable"
    )
    invocation = {
        "type": "tool_call",
        "name": "lookup_order",
        "args": {} if validation_error else {"order_id": "order-1"},
        "id": "call-1",
    }
    config = {"callbacks": [handler]}
    result = (
        asyncio.run(lookup_order.ainvoke(invocation, config))
        if async_call
        else lookup_order.invoke(invocation, config)
    )
    handler.flush()

    assert isinstance(result, ToolMessage)
    assert result.status == "error"
    assert len(calls) == 1
    trace = calls[0]["body"]["trace"]
    span = next(span for span in trace["spans"] if span["type"] == "tool")
    assert span["status"] == "ERROR"
    assert span["error"] == expected
    assert "output" not in span
    assert trace["status"] == "ERROR"
    assert trace["error"] == expected


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("  Connection refused  ", "Connection refused"),
        (
            ["Service unavailable", {"type": "text", "text": "Try later"}],
            "Service unavailable\nTry later",
        ),
        (
            [{"type": "image_url", "image_url": "not-an-error-message"}],
            "Tool returned an error result",
        ),
        ("", "Tool returned an error result"),
    ],
)
@pytest.mark.parametrize("serialized", [False, True])
def test_error_tool_message_content(content, expected, serialized):
    calls = []
    handler = langchain(
        api_key="key", project_id=PROJECT_ID, transport=make_transport(calls)
    )
    handler.on_tool_start({"name": "lookup_order"}, "order-1", run_id="tool-1")
    message = ToolMessage(content=content, tool_call_id="call-1", status="error")
    handler.on_tool_end(message.model_dump() if serialized else message, run_id="tool-1")
    trace = calls[0]["body"]["trace"]
    span = next(span for span in trace["spans"] if span["type"] == "tool")
    assert span["status"] == "ERROR"
    assert span["error"] == expected
    assert "output" not in span


def test_success_tool_message_output_is_preserved():
    calls = []
    handler = langchain(
        api_key="key", project_id=PROJECT_ID, transport=make_transport(calls)
    )
    message = ToolMessage(
        content="No error was found", tool_call_id="call-1", status="success"
    )
    handler.on_tool_start({"name": "lookup_order"}, "order-1", run_id="tool-1")
    handler.on_tool_end(message, run_id="tool-1")
    span = calls[0]["body"]["trace"]["spans"][0]
    assert span.get("status") != "ERROR"
    assert "error" not in span
    assert span["output"] == str(message)
