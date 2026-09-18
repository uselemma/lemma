from datetime import datetime, timezone

from uselemma_tracing.langchain_span_filter import (
    StoredRun,
    end_run_handle,
    keep_span,
    store_run,
)


def test_keep_span_exact_glob_and_predicate():
    assert keep_span("answer", (), None) is True
    assert keep_span("Middleware0.awrap_model_call", ("*.awrap_model_call",), None) is False
    assert keep_span("answer", ("*.awrap_model_call",), None) is True
    assert keep_span("hook", ("hook",), None) is False
    assert keep_span("ChatOpenAI", (), lambda name: "awrap" not in name) is True
    assert keep_span("Middleware0.awrap_model_call", (), lambda name: "awrap" not in name) is False


class _Handle:
    def __init__(self):
        self.ended = []

    def end(self, **kwargs):
        self.ended.append(kwargs)


def test_store_run_skips_and_passthrough_parent_handle():
    runs: dict[str, StoredRun] = {}
    parent_handle = _Handle()
    parent = StoredRun(
        owning_trace_id="root",
        root_run_id="root",
        kind="chain",
        started_at=datetime.now(timezone.utc),
        owns_trace=False,
        handle=parent_handle,
    )
    started = []

    skipped = store_run(
        runs,
        "hook",
        name="Middleware0.awrap_model_call",
        kind="chain",
        started_at=datetime.now(timezone.utc),
        owning_trace_id="root",
        root_run_id="root",
        owns_trace=False,
        parent_run_id="node",
        parent=parent,
        start_handle=lambda: started.append("created") or _Handle(),
        exclude_span_names=("*.awrap_model_call",),
        include_span=None,
    )
    assert skipped.skipped is True
    assert skipped.handle is parent_handle
    assert started == []

    end_run_handle(skipped, output="should-not-end-parent")
    assert parent_handle.ended == []

    kept = store_run(
        runs,
        "llm",
        name="ChatOpenAI",
        kind="llm",
        started_at=datetime.now(timezone.utc),
        owning_trace_id="root",
        root_run_id="root",
        owns_trace=False,
        parent_run_id="hook",
        parent=skipped,
        start_handle=lambda: _Handle(),
        exclude_span_names=("*.awrap_model_call",),
        include_span=None,
    )
    assert kept.skipped is False
    assert kept.handle is not parent_handle
    end_run_handle(kept, output="ok")
    assert kept.handle.ended == [{"output": "ok"}]
