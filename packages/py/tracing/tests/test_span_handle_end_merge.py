from uselemma_tracing import TraceContext


def test_span_handle_end_preserves_open_attributes_when_end_adds_new_ones():
    """Open-time attributes must survive when end() supplies additional attrs."""
    ctx = TraceContext(name="attr-merge-test")
    handle = ctx.start_span(
        name="my-tool",
        attributes={"custom.user_id": "u123", "custom.env": "prod"},
    )
    handle.end(
        output="done",
        attributes={"custom.output_tokens": 42},
    )
    span = ctx.spans[0]
    attrs = span.get("attributes", {})
    assert attrs.get("custom.user_id") == "u123"
    assert attrs.get("custom.env") == "prod"
    assert attrs.get("custom.output_tokens") == 42


def test_span_handle_end_end_time_attributes_win_on_conflict():
    """When both open-time and end-time supply the same key, end-time wins."""
    ctx = TraceContext(name="attr-conflict-test")
    handle = ctx.start_span(
        name="my-tool",
        attributes={"custom.status": "pending"},
    )
    handle.end(attributes={"custom.status": "done"})
    span = ctx.spans[0]
    attrs = span.get("attributes", {})
    assert attrs.get("custom.status") == "done"


def test_span_handle_end_preserves_open_attrs_when_end_passes_no_attrs():
    """If end() passes no attributes at all, open-time attrs must still be there."""
    ctx = TraceContext(name="attr-no-end-attrs-test")
    handle = ctx.start_span(
        name="my-tool",
        attributes={"custom.user_id": "u999"},
    )
    handle.end(output="result")
    span = ctx.spans[0]
    attrs = span.get("attributes", {})
    assert attrs.get("custom.user_id") == "u999"


def test_span_handle_end_merges_metadata():
    """Open-time metadata must be shallow-merged with end-time metadata."""
    ctx = TraceContext(name="metadata-merge-test")
    handle = ctx.start_span(
        name="my-tool",
        metadata={"env": "staging", "version": "1"},
    )
    handle.end(metadata={"result_code": "200"})
    span = ctx.spans[0]
    meta = span.get("metadata", {})
    assert meta.get("env") == "staging"
    assert meta.get("version") == "1"
    assert meta.get("result_code") == "200"


def test_span_handle_end_metadata_end_time_wins_on_conflict():
    """When both open and end-time metadata supply the same key, end-time wins."""
    ctx = TraceContext(name="metadata-conflict-test")
    handle = ctx.start_span(
        name="my-tool",
        metadata={"env": "staging"},
    )
    handle.end(metadata={"env": "production"})
    span = ctx.spans[0]
    assert span.get("metadata", {}).get("env") == "production"


def test_open_span_journal_replay_merges_attributes_and_metadata():
    """Turn journal replay (_open_span) populates open_kwargs.

    SpanHandle.end() must not let open_kwargs clobber end-time attributes or metadata.
    """
    ctx = TraceContext(name="journal-replay-test")
    handle = ctx._open_span(
        name="replay-span",
        attributes={"open_key": "val1", "shared_key": "from_open"},
        metadata={"open_meta": "meta1", "shared_meta": "from_open"},
    )
    handle.end(
        attributes={"end_key": "val2", "shared_key": "from_end"},
        metadata={"end_meta": "meta2", "shared_meta": "from_end"},
    )
    span = ctx.spans[0]
    attrs = span.get("attributes", {})
    assert attrs.get("open_key") == "val1"
    assert attrs.get("end_key") == "val2"
    assert attrs.get("shared_key") == "from_end"

    meta = span.get("metadata", {})
    assert meta.get("open_meta") == "meta1"
    assert meta.get("end_meta") == "meta2"
    assert meta.get("shared_meta") == "from_end"
