import uuid

from uselemma_tracing.langsmith_parent import (
    ancestor_ids_from_dotted_order,
    resolve_traceable_ghost,
)


def test_ancestor_ids_nearest_first_and_skips_current_node():
    root = str(uuid.uuid4())
    mid = str(uuid.uuid4())
    leaf = str(uuid.uuid4())
    dotted = (
        f"20240101T000000000000Z{root}"
        f".20240101T000001000000Z{mid}"
        f".20240101T000002000000Z{leaf}"
    )
    assert ancestor_ids_from_dotted_order(dotted) == [mid, root]


def test_ancestor_ids_skip_malformed_segments():
    root = str(uuid.uuid4())
    dotted = (
        f"20240101T000000000000Z{root}"
        ".not-a-uuid"
        f".20240101T000002000000Z{uuid.uuid4()}"
    )
    assert ancestor_ids_from_dotted_order(dotted) == [root]


def test_ancestor_ids_empty_and_single_node():
    assert ancestor_ids_from_dotted_order("") == []
    leaf = str(uuid.uuid4())
    assert ancestor_ids_from_dotted_order(f"20240101T000000000000Z{leaf}") == []


def test_resolve_ghost_returns_nearest_known_ancestor(monkeypatch):
    root = str(uuid.uuid4())
    mid = str(uuid.uuid4())
    ghost = str(uuid.uuid4())
    dotted = (
        f"20240101T000000000000Z{root}"
        f".20240101T000001000000Z{mid}"
        f".20240101T000002000000Z{ghost}"
    )

    class _Tree:
        id = ghost
        dotted_order = dotted

    monkeypatch.setattr(
        "uselemma_tracing.langsmith_parent._get_tracing_context",
        lambda: {"parent": _Tree()},
    )
    assert resolve_traceable_ghost(ghost, {root}) == root
    assert resolve_traceable_ghost(ghost, {mid, root}) == mid


def test_resolve_ghost_ignores_parent_that_is_not_active_node(monkeypatch):
    ghost = str(uuid.uuid4())
    other = str(uuid.uuid4())
    root = str(uuid.uuid4())

    class _Tree:
        id = other
        dotted_order = f"20240101T000000000000Z{root}.20240101T000001000000Z{other}"

    monkeypatch.setattr(
        "uselemma_tracing.langsmith_parent._get_tracing_context",
        lambda: {"parent": _Tree()},
    )
    assert resolve_traceable_ghost(ghost, {root}) is None


def test_resolve_ghost_without_langsmith_is_noop(monkeypatch):
    monkeypatch.setattr(
        "uselemma_tracing.langsmith_parent._get_tracing_context",
        None,
    )
    assert resolve_traceable_ghost(str(uuid.uuid4()), {"known"}) is None
