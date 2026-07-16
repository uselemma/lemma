from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .client import Lemma, SpanHandle, TraceContext, _now
from .tool_result import tool_result_error


@dataclass
class _Run:
    kind: str
    parent_run_id: str | None = None
    handle: SpanHandle | None = None
    trace: TraceContext | None = None
    started_at: datetime | None = None


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _serialized_name(serialized: Any, fallback: str) -> str:
    name = _get(serialized, "name")
    if isinstance(name, str) and name:
        return name
    ids = _get(serialized, "id")
    if isinstance(ids, list) and ids:
        return str(ids[-1])
    return fallback


def _model_name(serialized: Any) -> str | None:
    kwargs = _get(serialized, "kwargs", {}) or {}
    for source in (kwargs, serialized):
        for key in ("model", "model_name", "modelName", "model_id", "modelId"):
            value = _get(source, key)
            if isinstance(value, str):
                return value
    return None


def _first_text(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if isinstance(value.get("text"), str):
            return value["text"]
        if isinstance(value.get("content"), str):
            return value["content"]
        return _first_text(value.get("message"))
    text = getattr(value, "text", None)
    if isinstance(text, str):
        return text
    content = getattr(value, "content", None)
    if isinstance(content, str):
        return content
    message = getattr(value, "message", None)
    if message is not None:
        return _first_text(message)
    return None


def _llm_output(response: Any) -> Any:
    generations = _get(response, "generations")
    if not isinstance(generations, list):
        return response
    text = "".join(
        text
        for group in generations
        if isinstance(group, list)
        for item in group
        if (text := _first_text(item))
    )
    return text or generations



def _error_message(error: Any) -> str:
    return str(error)


class LemmaLangChainCallbackHandler:
    name = "lemma"

    def __init__(
        self,
        lemma: Lemma | None = None,
        *,
        api_key: str | None = None,
        project_id: str | None = None,
        base_url: str = "https://api.uselemma.ai",
        transport: Any = None,
        agent_name: str | None = None,
        metadata: dict[str, Any] | None = None,
        record_inputs: bool = True,
        record_outputs: bool = True,
    ) -> None:
        self.lemma = lemma or Lemma(
            api_key=api_key,
            project_id=project_id,
            base_url=base_url,
            transport=transport,
        )
        self.agent_name = agent_name
        self.metadata = metadata or {}
        self.record_inputs = record_inputs
        self.record_outputs = record_outputs
        self._runs: dict[str, _Run] = {}

    def _trace_name(self, serialized: Any, fallback: str) -> str:
        return self.agent_name or _serialized_name(serialized, fallback)

    def _start_trace(
        self,
        run_id: str,
        serialized: Any,
        input: Any,
        fallback_name: str,
        metadata: dict[str, Any] | None = None,
    ) -> TraceContext:
        ctx = TraceContext(
            name=self._trace_name(serialized, fallback_name),
            input=input if self.record_inputs else None,
            metadata={
                **self.metadata,
                **(metadata or {}),
                "langchain_run_id": str(run_id),
            },
        )
        self._runs[str(run_id)] = _Run(kind="chain", trace=ctx, started_at=_now())
        return ctx

    def _parent(self, parent_run_id: str | None) -> _Run | None:
        if parent_run_id is None:
            return None
        return self._runs.get(str(parent_run_id))

    def _parent_target(self, parent_run_id: str | None) -> TraceContext | SpanHandle | None:
        parent = self._parent(parent_run_id)
        if parent is None:
            return None
        return parent.handle or parent.trace

    def _start_span(
        self, parent: TraceContext | SpanHandle, **kwargs: Any
    ) -> SpanHandle:
        if isinstance(parent, SpanHandle):
            return parent.trace.start_span(parent_id=parent.id, **kwargs)
        return parent.start_span(**kwargs)

    def _start_generation(
        self, parent: TraceContext | SpanHandle, **kwargs: Any
    ) -> SpanHandle:
        if isinstance(parent, SpanHandle):
            return parent.trace.start_generation(parent_id=parent.id, **kwargs)
        return parent.start_generation(**kwargs)

    def _start_tool(
        self, parent: TraceContext | SpanHandle, **kwargs: Any
    ) -> SpanHandle:
        if isinstance(parent, SpanHandle):
            return parent.trace.start_tool(parent_id=parent.id, **kwargs)
        return parent.start_tool(**kwargs)

    def on_chain_start(
        self,
        serialized: Any,
        inputs: Any,
        *,
        run_id: str,
        parent_run_id: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        run_type: str | None = None,
        name: str | None = None,
        **_: Any,
    ) -> None:
        parent = self._parent_target(parent_run_id)
        if parent is None:
            trace_serialized = dict(serialized or {})
            if name:
                trace_serialized["name"] = name
            self._start_trace(run_id, trace_serialized, inputs, "langchain-run", metadata)
            return
        handle = self._start_span(
            parent,
            name=name or _serialized_name(serialized, "langchain-chain"),
            input=inputs if self.record_inputs else None,
            metadata=self.metadata,
            attributes={
                "langchain.run_id": str(run_id),
                "langchain.parent_run_id": str(parent_run_id),
                "langchain.run_type": run_type or "chain",
            },
        )
        self._runs[str(run_id)] = _Run(
            kind="chain", parent_run_id=str(parent_run_id), handle=handle
        )

    def on_chain_end(self, outputs: Any, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        if run.trace is not None:
            if self.record_outputs:
                run.trace.output(outputs)
            self.lemma._send(run.trace, run.started_at or _now(), _now())
            return
        run.handle and run.handle.end(output=outputs if self.record_outputs else None)

    def on_chain_error(self, error: BaseException, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return
        if run.trace is not None:
            run.trace.fail(error)
            self.lemma._send(run.trace, run.started_at or _now(), _now())
            return
        run.handle and run.handle.end(status="ERROR", error=_error_message(error))

    def on_llm_start(
        self,
        serialized: Any,
        prompts: list[str],
        *,
        run_id: str,
        parent_run_id: str | None = None,
        invocation_params: dict[str, Any] | None = None,
        **_: Any,
    ) -> None:
        parent = self._parent_target(parent_run_id) or self._start_trace(
            run_id, serialized, prompts, "langchain-llm"
        )
        handle = self._start_generation(
            parent,
            name=_serialized_name(serialized, "langchain-llm"),
            input=prompts if self.record_inputs else None,
            metadata=self.metadata,
            model=_model_name(serialized),
            llm_provider="langchain",
            llm_input_messages=(
                [{"role": "user", "content": prompt} for prompt in prompts]
                if self.record_inputs
                else None
            ),
            llm_invocation_parameters=invocation_params,
            attributes={
                "langchain.run_id": str(run_id),
                "langchain.parent_run_id": str(parent_run_id)
                if parent_run_id is not None
                else None,
                "langchain.run_type": "llm",
            },
        )
        self._runs[str(run_id)] = _Run(
            kind="llm",
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_chat_model_start(
        self,
        serialized: Any,
        messages: list[list[Any]],
        *,
        run_id: str,
        parent_run_id: str | None = None,
        invocation_params: dict[str, Any] | None = None,
        **_: Any,
    ) -> None:
        flat_messages = [message for group in messages for message in group]
        parent = self._parent_target(parent_run_id) or self._start_trace(
            run_id, serialized, flat_messages, "langchain-chat-model"
        )
        handle = self._start_generation(
            parent,
            name=_serialized_name(serialized, "langchain-chat-model"),
            input=flat_messages if self.record_inputs else None,
            metadata=self.metadata,
            model=_model_name(serialized),
            llm_provider="langchain",
            llm_input_messages=flat_messages if self.record_inputs else None,
            llm_invocation_parameters=invocation_params,
            attributes={
                "langchain.run_id": str(run_id),
                "langchain.parent_run_id": str(parent_run_id)
                if parent_run_id is not None
                else None,
                "langchain.run_type": "llm",
            },
        )
        self._runs[str(run_id)] = _Run(
            kind="llm",
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_llm_end(self, response: Any, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None or run.handle is None:
            return
        output = _llm_output(response)
        run.handle.end(
            output=output if self.record_outputs else None,
            llm_output_messages=(
                [{"role": "assistant", "content": output}]
                if self.record_outputs and output is not None
                else None
            ),
        )

    def on_llm_error(self, error: BaseException, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        run and run.handle and run.handle.end(status="ERROR", error=_error_message(error))

    def on_tool_start(
        self,
        serialized: Any,
        input_str: Any,
        *,
        run_id: str,
        parent_run_id: str | None = None,
        **_: Any,
    ) -> None:
        parent = self._parent_target(parent_run_id) or self._start_trace(
            run_id, serialized, input_str, "langchain-tool"
        )
        name = _serialized_name(serialized, "langchain-tool")
        handle = self._start_tool(
            parent,
            name=name,
            tool_name=name,
            input=input_str if self.record_inputs else None,
            metadata=self.metadata,
            attributes={
                "langchain.run_id": str(run_id),
                "langchain.parent_run_id": str(parent_run_id)
                if parent_run_id is not None
                else None,
                "langchain.run_type": "tool",
            },
        )
        self._runs[str(run_id)] = _Run(
            kind="tool",
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_tool_end(self, output: Any, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        if run is None or run.handle is None:
            return
        soft_error = tool_result_error(output)
        if soft_error is not None:
            run.handle.end(
                status="ERROR",
                error=soft_error if self.record_outputs else None,
            )
            return
        run.handle.end(output=output if self.record_outputs else None)

    def on_tool_error(self, error: BaseException, *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        run and run.handle and run.handle.end(
            status="ERROR", error=_error_message(error)
        )

    def on_retriever_start(
        self,
        serialized: Any,
        query: str,
        *,
        run_id: str,
        parent_run_id: str | None = None,
        **_: Any,
    ) -> None:
        parent = self._parent_target(parent_run_id) or self._start_trace(
            run_id, serialized, query, "langchain-retriever"
        )
        handle = self._start_span(
            parent,
            name=_serialized_name(serialized, "langchain-retriever"),
            input=query if self.record_inputs else None,
            metadata=self.metadata,
            attributes={
                "langchain.run_id": str(run_id),
                "langchain.parent_run_id": str(parent_run_id)
                if parent_run_id is not None
                else None,
                "langchain.run_type": "retriever",
            },
        )
        self._runs[str(run_id)] = _Run(
            kind="retriever",
            parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
            handle=handle,
        )

    def on_retriever_end(self, documents: list[Any], *, run_id: str, **_: Any) -> None:
        run = self._runs.pop(str(run_id), None)
        run and run.handle and run.handle.end(
            output=documents if self.record_outputs else None,
        )

    def on_retriever_error(
        self, error: BaseException, *, run_id: str, **_: Any
    ) -> None:
        run = self._runs.pop(str(run_id), None)
        run and run.handle and run.handle.end(
            status="ERROR", error=_error_message(error)
        )


def langchain(**options: Any) -> LemmaLangChainCallbackHandler:
    return LemmaLangChainCallbackHandler(**options)


def langgraph(**options: Any) -> LemmaLangChainCallbackHandler:
    return LemmaLangChainCallbackHandler(agent_name="langgraph-agent", **options)
