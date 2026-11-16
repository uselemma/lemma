"""Model-call input and output for OpenAI Agents container spans.

Agent, task, and turn spans carry no model payload of their own. They take the
first input and the latest output of the model calls beneath them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .client import SpanHandle


def is_container_type(span_type: Any) -> bool:
    return span_type in {"agent", "task", "turn"}


@dataclass
class SpanRecord:
    handle: SpanHandle
    trace_id: str
    type: str | None
    parent_id: str | None
    # True once the span ended carrying its own output.
    own_output: bool = False
    # First input of a model call under this container, while it is open.
    child_input: Any = None
    # Latest output of a model call under this container, while it is open.
    child_output: Any = None


def propagate_generation_io(
    parent_id: str | None,
    input_value: Any,
    output: Any,
    open_spans: Mapping[str, SpanRecord],
    ended_spans: Mapping[str, SpanRecord],
) -> None:
    """Hand a finished model call's input and output to every container above it.

    An open container accumulates them for its own end; one that already ended
    is filled in place.
    """
    if input_value is None and output is None:
        return
    seen: set[str] = set()
    while parent_id and parent_id not in seen:
        seen.add(parent_id)
        ended = ended_spans.get(parent_id)
        record = ended or open_spans.get(parent_id)
        if record is None:
            return
        if is_container_type(record.type):
            if ended is not None:
                ended.handle.fill_container_io(input_value, output, ended.own_output)
            else:
                if record.child_input is None:
                    record.child_input = input_value
                if output is not None:
                    record.child_output = output
        parent_id = record.parent_id
