from __future__ import annotations

from uselemma_tracing.error_message import (
    describe_error,
    error_message,
    failure_message,
)


def test_returns_none_only_when_there_is_no_error():
    assert error_message(None) is None
    assert error_message("   ") is None
    assert describe_error(None) == "Error"


def test_keeps_generic_exception_messages_unqualified():
    assert error_message(Exception("boom")) == "boom"
    assert error_message("lookup failed") == "lookup failed"


def test_qualifies_subclass_exceptions_with_their_class_name():
    assert error_message(ValueError("bad input")) == "ValueError: bad input"

    class ToolTimeout(RuntimeError):
        pass

    assert error_message(ToolTimeout("timed out")) == "ToolTimeout: timed out"


def test_does_not_repeat_a_class_name_the_message_already_carries():
    assert (
        error_message(ValueError("ValueError: already qualified"))
        == "ValueError: already qualified"
    )


def test_never_returns_an_empty_message_for_a_message_less_error():
    assert error_message(ValueError()) == "ValueError"
    assert error_message(Exception()) == "Exception"
    assert error_message({"message": ""}) == "Error"


def test_serializes_mapping_payloads():
    # Compact, matching the TypeScript SDK's JSON.stringify byte for byte.
    assert error_message({"code": 502, "detail": "upstream"}) == (
        '{"code":502,"detail":"upstream"}'
    )
    assert error_message({"name": "HttpError", "message": "bad gateway"}) == (
        "HttpError: bad gateway"
    )
    assert error_message({}) == "Error"


def test_failure_message_reports_no_failure_only_for_none():
    assert failure_message(None) is None
    assert failure_message("") == "Error"


def test_failure_message_keeps_failures_without_a_readable_message():
    assert failure_message("   ") == "Error"
    assert failure_message({}) == "Error"
    assert failure_message(ValueError()) == "ValueError"
