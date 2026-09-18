import json

from helpers import PROJECT_ID, make_transport
from uselemma_tracing import langchain, langgraph


def test_langchain_records_generation_retriever_and_tool_children():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start(
        {"id": ["langchain", "chains", "RunnableSequence"]},
        {"input": "where is my order?"},
        run_id="chain-1",
        metadata={"thread_id": "thread-1", "user_id": "user-1"},
        name="support-agent",
    )
    handler.on_llm_start(
        {
            "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        ["where is my order?"],
        run_id="llm-1",
        parent_run_id="chain-1",
    )
    handler.on_llm_end(
        {"generations": [[{"text": "I should search docs."}]]},
        run_id="llm-1",
    )
    handler.on_retriever_start(
        {"id": ["langchain", "retrievers", "VectorStoreRetriever"]},
        "order",
        run_id="retriever-1",
        parent_run_id="chain-1",
    )
    handler.on_retriever_end([{"page_content": "Shipping docs"}], run_id="retriever-1")
    handler.on_tool_start(
        {"name": "search_docs"},
        {"query": "order"},
        run_id="tool-1",
        parent_run_id="chain-1",
    )
    handler.on_tool_end([{"title": "Shipping"}], run_id="tool-1")
    handler.on_chain_end({"answer": "It arrives Friday."}, run_id="chain-1")

    body = calls[0]["body"]
    assert body["trace"]["name"] == "support-agent"
    assert body["trace"]["input"] == "where is my order?"
    assert body["trace"]["output"] == "It arrives Friday."
    assert body["trace"]["thread_id"] == "thread-1"
    assert body["trace"]["user_id"] == "user-1"
    assert body["trace"]["metadata"] == {
        "thread_id": "thread-1",
        "user_id": "user-1",
        "langchain_run_id": "chain-1",
    }

    generation, retriever, tool = body["trace"]["spans"]
    assert generation["name"] == "ChatOpenAI"
    assert generation["type"] == "generation"
    assert generation["input"] == ["where is my order?"]
    assert generation["output"] == "I should search docs."
    assert generation["model"] == "gpt-4o"
    assert generation["attributes"]["llm.provider"] == "openai"
    assert retriever["name"] == "VectorStoreRetriever"
    assert retriever["type"] == "span"
    assert retriever["output"] == [{"page_content": "Shipping docs"}]
    assert tool["name"] == "search_docs"
    assert tool["type"] == "tool"
    assert tool["tool_name"] == "search_docs"
    assert tool["output"] == [{"title": "Shipping"}]


def test_llm_end_emits_usage_from_llm_output_token_usage():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_llm_start(
        {"id": ["langchain_openai", "chat_models", "ChatOpenAI"], "kwargs": {"model": "gpt-4o"}},
        ["hello"],
        run_id="llm-usage",
    )
    handler.on_llm_end(
        {
            "generations": [[{"text": "hi"}]],
            "llm_output": {
                "tokenUsage": {
                    "promptTokens": 12,
                    "completionTokens": 3,
                    "totalTokens": 15,
                }
            },
        },
        run_id="llm-usage",
    )

    body = calls[0]["body"]
    span = body["trace"]["spans"][0]
    assert span["usage"] == {"input_tokens": 12, "output_tokens": 3}
    assert span["attributes"]["llm.provider"] == "openai"
    assert span["attributes"]["gen_ai.usage.input_tokens"] == 12
    assert span["attributes"]["lemma.sdk.integration"] == "langchain"
    assert span["attributes"]["lemma.sdk.language"] == "python"


def test_chat_model_end_stamps_response_metadata_model_name():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chat_model_start(
        {
            "id": ["langchain", "chat_models", "fake", "FakeMessagesListChatModel"],
            "name": "FakeMessagesListChatModel",
            "kwargs": {"responses": [{"type": "ai", "content": "It arrives Friday."}]},
        },
        [[{"type": "human", "content": "where is my order?"}]],
        run_id="llm-fake",
    )
    handler.on_llm_end(
        {
            "generations": [
                [
                    {
                        "text": "It arrives Friday.",
                        "message": {
                            "type": "ai",
                            "content": "It arrives Friday.",
                            "response_metadata": {"model_name": "gpt-4o-mini"},
                        },
                    }
                ]
            ]
        },
        run_id="llm-fake",
    )

    span = calls[0]["body"]["trace"]["spans"][0]
    assert span["type"] == "generation"
    assert span["model"] == "gpt-4o-mini"
    assert span["attributes"]["llm.model_name"] == "gpt-4o-mini"
    assert span["attributes"]["gen_ai.request.model"] == "gpt-4o-mini"
    assert span["attributes"]["ai.model.id"] == "gpt-4o-mini"


def test_chat_model_reads_ls_model_name_from_run_metadata():
    """Non-serializable chat models still get model identity from ls_* metadata."""
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start(
        {"name": "agent"},
        {},
        run_id="root",
        metadata={"thread_id": "t"},
    )
    handler.on_chat_model_start(
        {
            "lc": 1,
            "type": "not_implemented",
            "id": ["langchain_perplexity", "chat_models", "ChatPerplexity"],
        },
        [[{"role": "user", "content": "hi"}]],
        run_id="llm",
        parent_run_id="root",
        invocation_params={},
        metadata={"ls_model_name": "sonar-pro", "ls_provider": "perplexity"},
    )
    handler.on_llm_end(
        {"generations": [[{"text": "ok", "message": None}]]},
        run_id="llm",
    )
    handler.on_chain_end({}, run_id="root")

    span = next(
        s for s in calls[0]["body"]["trace"]["spans"] if s.get("type") == "generation"
    )
    assert span["model"] == "sonar-pro"
    assert span["attributes"]["llm.model_name"] == "sonar-pro"
    assert span["attributes"]["llm.provider"] == "perplexity"


def test_llm_start_reads_ls_identity_from_run_metadata_when_class_id_is_unknown():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_llm_start(
        {"lc": 1, "type": "not_implemented", "id": ["custom_pkg", "llms", "CustomLLM"]},
        ["hello"],
        run_id="llm-meta",
        invocation_params={},
        metadata={"ls_model_name": "custom-7b", "ls_provider": "acme"},
    )
    handler.on_llm_end(
        {"generations": [[{"text": "hi"}]]},
        run_id="llm-meta",
    )

    span = calls[0]["body"]["trace"]["spans"][0]
    assert span["model"] == "custom-7b"
    assert span["attributes"]["llm.provider"] == "acme"


def test_serialized_kwargs_model_wins_over_run_metadata():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chat_model_start(
        {
            "id": ["langchain_openai", "chat_models", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        [[{"type": "human", "content": "hi"}]],
        run_id="llm-kw",
        invocation_params={"model": "gpt-4o"},
        metadata={"ls_model_name": "sonar-pro"},
    )
    handler.on_llm_end(
        {"generations": [[{"text": "ok"}]]},
        run_id="llm-kw",
    )

    span = calls[0]["body"]["trace"]["spans"][0]
    assert span["model"] == "gpt-4o"
    assert span["attributes"]["llm.provider"] == "openai"


def test_standalone_chat_model_finalizes_one_owned_trace():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chat_model_start(
        {
            "id": ["langchain_openai", "chat_models", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o-mini"},
        },
        [
            [
                {"type": "system", "content": "Be brief."},
                {"type": "human", "content": "hello"},
            ]
        ],
        run_id="llm-solo",
        metadata={"conversation_id": "conv-9", "customer_id": "cust-3"},
        invocation_params={"temperature": 0},
    )
    handler.on_llm_end(
        {
            "generations": [
                [
                    {
                        "message": {
                            "type": "ai",
                            "content": "hi there",
                            "tool_calls": [{"id": "call_1", "name": "noop", "args": {}}],
                        }
                    }
                ]
            ]
        },
        run_id="llm-solo",
    )
    # Owned LLM ends with tool_calls defer finalize until flush / final answer.
    handler.flush()

    assert len(calls) == 1
    body = calls[0]["body"]
    assert body["trace"]["name"] == "ChatOpenAI"
    assert body["trace"]["input"] == "hello"
    assert body["trace"]["output"] == {
        "role": "assistant",
        "content": "hi there",
        "tool_calls": [{"id": "call_1", "name": "noop", "args": {}}],
    }
    assert body["trace"]["thread_id"] == "conv-9"
    span = body["trace"]["spans"][0]
    assert span["type"] == "generation"
    assert span["model"] == "gpt-4o-mini"
    assert span["attributes"]["llm.provider"] == "openai"
    assert span["input"] == [
        {"role": "system", "content": "Be brief."},
        {"role": "user", "content": "hello"},
    ]


def test_configurable_conversation_and_user_keys():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
        thread_id_key="conversation_id",
        user_id_key="customer_id",
    )

    handler.on_chain_start(
        {"name": "agent"},
        "hi",
        run_id="chain-1",
        tags=["conversation_id:from-tag"],
        metadata={
            "conversation_id": "conv-meta",
            "customer_id": "cust-meta",
            "user_id": "ignored",
        },
    )
    handler.on_chain_end("ok", run_id="chain-1")

    body = calls[0]["body"]
    assert body["trace"]["thread_id"] == "conv-meta"
    assert body["trace"]["user_id"] == "cust-meta"


def test_concurrent_roots_and_missing_parent_isolation():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start({"name": "a"}, "one", run_id="chain-a")
    handler.on_chain_start({"name": "b"}, "two", run_id="chain-b")
    handler.on_llm_start(
        {
            "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        ["orphan"],
        run_id="llm-orphan",
        parent_run_id="missing-parent",
    )
    handler.on_llm_end(
        {"generations": [[{"text": "orphan-out"}]]},
        run_id="llm-orphan",
    )
    handler.on_chain_end("out-a", run_id="chain-a")
    handler.on_chain_end("out-b", run_id="chain-b")

    assert len(calls) == 3
    by_name = {call["body"]["trace"]["name"]: call["body"]["trace"] for call in calls}
    assert by_name["a"]["input"] == "one"
    assert by_name["a"]["output"] == "out-a"
    assert by_name["b"]["input"] == "two"
    assert by_name["b"]["output"] == "out-b"
    assert by_name["a"].get("spans") in (None, [])
    assert by_name["ChatOpenAI"]["input"] == "orphan"
    assert by_name["ChatOpenAI"]["output"] == "orphan-out"
    assert len(by_name["ChatOpenAI"]["spans"]) == 1


def test_langsmith_traceable_ghost_parent_stays_one_root(monkeypatch):
    """Unknown parent that is the active LangSmith node aliases to a known ancestor."""
    import uuid

    root_id = str(uuid.uuid4())
    ghost_id = str(uuid.uuid4())
    mid_ghost_id = str(uuid.uuid4())
    llm_id = str(uuid.uuid4())
    dotted = (
        f"20240101T000000000000Z{root_id}"
        f".20240101T000001000000Z{mid_ghost_id}"
        f".20240101T000002000000Z{ghost_id}"
    )

    class _Tree:
        id = ghost_id
        dotted_order = dotted

    monkeypatch.setattr(
        "uselemma_tracing.langsmith_parent._get_tracing_context",
        lambda: {"parent": _Tree()},
    )

    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )
    handler.on_chain_start({"name": "support-agent"}, "hello", run_id=root_id)
    handler.on_chat_model_start(
        {
            "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        [[{"type": "human", "content": "hello"}]],
        run_id=llm_id,
        parent_run_id=ghost_id,
    )
    handler.on_llm_end(
        {"generations": [[{"text": "hi"}]]},
        run_id=llm_id,
    )
    handler.on_chain_end("hi", run_id=root_id)

    assert len(calls) == 1
    trace = calls[0]["body"]["trace"]
    assert trace["name"] == "support-agent"
    assert len(trace["spans"]) == 1
    assert trace["spans"][0]["type"] == "generation"


def test_unknown_parent_not_active_run_tree_stays_isolated(monkeypatch):
    import uuid

    ghost_id = str(uuid.uuid4())
    other_id = str(uuid.uuid4())

    class _Tree:
        id = other_id
        dotted_order = f"20240101T000000000000Z{other_id}"

    monkeypatch.setattr(
        "uselemma_tracing.langsmith_parent._get_tracing_context",
        lambda: {"parent": _Tree()},
    )

    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )
    handler.on_llm_start(
        {
            "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        ["orphan"],
        run_id="llm-orphan",
        parent_run_id=ghost_id,
    )
    handler.on_llm_end(
        {"generations": [[{"text": "orphan-out"}]]},
        run_id="llm-orphan",
    )

    assert len(calls) == 1
    assert calls[0]["body"]["trace"]["name"] == "ChatOpenAI"


def test_langsmith_ghost_parent_on_nested_chain_stays_one_root(monkeypatch):
    import uuid

    root_id = str(uuid.uuid4())
    ghost_id = str(uuid.uuid4())
    child_id = str(uuid.uuid4())
    dotted = (
        f"20240101T000000000000Z{root_id}.20240101T000001000000Z{ghost_id}"
    )

    class _Tree:
        id = ghost_id
        dotted_order = dotted

    monkeypatch.setattr(
        "uselemma_tracing.langsmith_parent._get_tracing_context",
        lambda: {"parent": _Tree()},
    )

    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )
    handler.on_chain_start({"name": "support-agent"}, "hello", run_id=root_id)
    handler.on_chain_start(
        {"name": "inner"},
        "hello",
        run_id=child_id,
        parent_run_id=ghost_id,
    )
    handler.on_chain_end("inner-out", run_id=child_id)
    handler.on_chain_end("hello", run_id=root_id)

    assert len(calls) == 1
    trace = calls[0]["body"]["trace"]
    assert trace["name"] == "support-agent"
    assert len(trace["spans"]) == 1
    assert trace["spans"][0]["name"] == "inner"


def test_langchain_records_errors():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start({"name": "support-agent"}, "hello", run_id="chain-1")
    handler.on_tool_start(
        {"name": "lookup"}, "hello", run_id="tool-1", parent_run_id="chain-1"
    )
    handler.on_tool_error(RuntimeError("lookup failed"), run_id="tool-1")
    handler.on_chain_error(RuntimeError("agent failed"), run_id="chain-1")

    body = calls[0]["body"]
    assert body["trace"]["status"] == "ERROR"
    assert body["trace"]["error"] == "RuntimeError: agent failed"
    assert body["trace"]["spans"][0]["status"] == "ERROR"
    assert body["trace"]["spans"][0]["error"] == "RuntimeError: lookup failed"
    assert "output" not in body["trace"]["spans"][0]


def test_langchain_fails_root_for_message_less_exceptions():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start({"name": "support-agent"}, "hello", run_id="chain-1")
    handler.on_tool_start(
        {"name": "lookup"}, "hello", run_id="tool-1", parent_run_id="chain-1"
    )
    handler.on_tool_error(ValueError(), run_id="tool-1")
    handler.on_chain_error(RuntimeError(), run_id="chain-1")

    body = calls[0]["body"]
    assert body["trace"]["status"] == "ERROR"
    assert body["trace"]["error"] == "RuntimeError"
    assert body["trace"]["spans"][0]["status"] == "ERROR"
    assert body["trace"]["spans"][0]["error"] == "ValueError"


def test_langchain_records_is_error_tool_end_as_error_without_output():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start({"name": "support-agent"}, "hello", run_id="chain-1")
    handler.on_tool_start(
        {"name": "pdf_server_pdf"},
        {"query": "YAT"},
        run_id="tool-1",
        parent_run_id="chain-1",
    )
    handler.on_tool_end(
        {
            "content": [{"type": "text", "text": "Internal error: Validation error"}],
            "isError": True,
        },
        run_id="tool-1",
    )
    handler.on_chain_end({"ok": True}, run_id="chain-1")

    span = calls[0]["body"]["trace"]["spans"][0]
    assert span["name"] == "pdf_server_pdf"
    assert span["status"] == "ERROR"
    assert span["error"] == "Internal error: Validation error"
    assert "output" not in span


def test_langchain_records_payload_encoded_tool_failure_as_error():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start({"name": "support-agent"}, "hello", run_id="chain-1")
    handler.on_tool_start(
        {"name": "return_delivered_order_items"},
        {"order_id": "#W-001"},
        run_id="tool-1",
        parent_run_id="chain-1",
    )
    handler.on_tool_end(
        {
            "isError": False,
            "content": [
                {
                    "type": "text",
                    "text": json.dumps({"error": "Error: Payment method not found"}),
                }
            ],
            "structuredContent": {"error": "Error: Payment method not found"},
        },
        run_id="tool-1",
    )
    handler.on_chain_end({"ok": True}, run_id="chain-1")

    span = calls[0]["body"]["trace"]["spans"][0]
    assert span["name"] == "return_delivered_order_items"
    assert span["status"] == "ERROR"
    assert span["error"] == "Error: Payment method not found"
    assert "output" not in span


def test_records_inputs_outputs_and_errors():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start(
        {"name": "agent"},
        {"input": "secret"},
        run_id="chain-1",
        metadata={"thread_id": "t1", "user_id": "u1"},
    )
    handler.on_llm_start(
        {
            "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        ["secret"],
        run_id="llm-1",
        parent_run_id="chain-1",
    )
    handler.on_llm_end(
        {"generations": [[{"text": "secret-out"}]]},
        run_id="llm-1",
    )
    handler.on_tool_start(
        {"name": "lookup"}, {"q": "secret"}, run_id="tool-1", parent_run_id="chain-1"
    )
    handler.on_tool_error(RuntimeError("boom"), run_id="tool-1")
    handler.on_chain_error(RuntimeError("failed"), run_id="chain-1")

    body = calls[0]["body"]
    assert body["trace"]["name"] == "agent"
    assert body["trace"]["status"] == "ERROR"
    assert body["trace"]["thread_id"] == "t1"
    assert body["trace"]["user_id"] == "u1"
    assert body["trace"]["input"] == "secret"
    assert body["trace"]["error"] == "RuntimeError: failed"
    assert body["trace"]["spans"][0]["type"] == "generation"
    assert body["trace"]["spans"][0]["model"] == "gpt-4o"
    assert body["trace"]["spans"][0]["input"] == ["secret"]
    assert body["trace"]["spans"][0]["output"] == "secret-out"
    assert body["trace"]["spans"][1]["status"] == "ERROR"
    assert body["trace"]["spans"][1]["error"] == "RuntimeError: boom"
    assert body["trace"]["spans"][1]["input"] == {"q": "secret"}
    assert body["trace"]["spans"][1].get("output") in (None, {})


def test_message_normalization_and_provider_from_class():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    class HumanMessage:
        def __init__(self, content):
            self.content = content

        def get_type(self):
            return "human"

    class AIMessage:
        def __init__(self, content, tool_calls):
            self.content = content
            self.tool_calls = tool_calls

        def get_type(self):
            return "ai"

    class SystemMessage:
        def __init__(self, content):
            self.content = content

        def get_type(self):
            return "system"

    class ToolMessage:
        def __init__(self, content, tool_call_id):
            self.content = content
            self.tool_call_id = tool_call_id

        def get_type(self):
            return "tool"

    handler.on_chat_model_start(
        {
            "name": "ChatAnthropic",
            "id": ["langchain_anthropic", "chat_models", "ChatAnthropic"],
            "kwargs": {"model": "claude-3"},
        },
        [
            [
                SystemMessage("sys"),
                HumanMessage("ask"),
                AIMessage("prior", [{"id": "c0", "name": "x", "args": {}}]),
                ToolMessage("tool-result", "c0"),
            ]
        ],
        run_id="llm-1",
    )
    handler.on_llm_end(
        {
            "generations": [
                [
                    {
                        "message": AIMessage(
                            "done",
                            [{"id": "c1", "name": "search", "args": {"q": "1"}}],
                        )
                    }
                ]
            ]
        },
        run_id="llm-1",
    )
    # Owned LLM ends with tool_calls defer finalize until flush / final answer.
    handler.flush()

    span = calls[0]["body"]["trace"]["spans"][0]
    assert span["attributes"]["llm.provider"] == "anthropic"
    assert span["model"] == "claude-3"
    assert span["input"] == [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "ask"},
        {
            "role": "assistant",
            "content": "prior",
            "tool_calls": [{"id": "c0", "name": "x", "args": {}}],
        },
        {"role": "tool", "content": "tool-result", "tool_call_id": "c0"},
    ]
    assert span["output"] == {
        "role": "assistant",
        "content": "done",
        "tool_calls": [{"id": "c1", "name": "search", "args": {"q": "1"}}],
    }


def test_flush_finalizes_once_and_shutdown_does_not_resend():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start({"name": "open"}, "hi", run_id="chain-1")
    handler.on_llm_start(
        {
            "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        ["hi"],
        run_id="llm-1",
        parent_run_id="chain-1",
    )
    handler.on_llm_end({"generations": [[{"text": "partial"}]]}, run_id="llm-1")

    handler.flush()
    assert len(calls) == 1
    assert calls[0]["body"]["trace"]["name"] == "open"
    assert calls[0]["body"]["trace"]["input"] == "hi"
    assert calls[0]["body"]["trace"]["output"] == "partial"

    handler.on_chain_end("late", run_id="chain-1")
    handler.shutdown()
    assert len(calls) == 1


def test_langgraph_uses_default_agent_name_and_nested_node_spans():
    calls = []
    handler = langgraph(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start({"name": "StateGraph"}, {"topic": "docs"}, run_id="graph-1")
    handler.on_chain_start(
        {"name": "retrieve"},
        {"topic": "docs"},
        run_id="node-1",
        parent_run_id="graph-1",
    )
    handler.on_chain_end({"docs": ["one"]}, run_id="node-1")
    handler.on_chain_start(
        {"name": "answer"},
        {"docs": ["one"]},
        run_id="node-2",
        parent_run_id="graph-1",
    )
    handler.on_chat_model_start(
        {
            "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        [[{"type": "human", "content": "summarize docs"}]],
        run_id="llm-1",
        parent_run_id="node-2",
    )
    handler.on_llm_end(
        {"generations": [[{"text": "done summary"}]]},
        run_id="llm-1",
    )
    handler.on_chain_end({"answer": "done"}, run_id="node-2")
    handler.on_chain_end({"answer": "done"}, run_id="graph-1")

    body = calls[0]["body"]
    assert body["trace"]["name"] == "langgraph-agent"
    assert body["trace"]["input"] == {"topic": "docs"}
    assert body["trace"]["output"] == "done"
    names = [span["name"] for span in body["trace"]["spans"]]
    assert names == ["retrieve", "answer", "ChatOpenAI"]
    assert body["trace"]["spans"][0]["output"] == {"docs": ["one"]}
    assert body["trace"]["spans"][2]["parent_id"] == body["trace"]["spans"][1]["id"]
    assert body["trace"]["spans"][2]["attributes"]["llm.provider"] == "openai"


def test_langgraph_extracts_current_turn_from_message_state():
    calls = []
    handler = langgraph(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
        thread_id_key="thread_id",
    )

    handler.on_chain_start(
        {"name": "StateGraph"},
        {
            "messages": [
                {"type": "human", "content": "first"},
                {"type": "ai", "content": "ack"},
                {"type": "human", "content": "second turn"},
            ]
        },
        run_id="graph-1",
        metadata={"thread_id": "tg-1"},
    )
    handler.on_chain_end(
        {
            "messages": [
                {"type": "human", "content": "second turn"},
                {"type": "ai", "content": "final answer"},
            ]
        },
        run_id="graph-1",
    )

    body = calls[0]["body"]
    assert body["trace"]["name"] == "langgraph-agent"
    assert body["trace"]["input"] == "second turn"
    assert body["trace"]["output"] == "final answer"
    assert body["trace"]["thread_id"] == "tg-1"


def test_langchain_forwards_release_onto_ingest_payload():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
        release="1.8.3",
    )
    handler.on_chain_start(
        {"id": ["langchain", "chains", "RunnableSequence"]},
        {"input": "hi"},
        run_id="chain-1",
    )
    handler.on_chain_end({"answer": "ok"}, run_id="chain-1")
    assert calls[0]["body"]["trace"]["release"] == "1.8.3"


def test_langchain_flush_does_not_raise_on_ingest_503():
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=lambda _url, _headers, _body: (503, "nope"),
    )
    handler.on_chain_start({"name": "support-agent"}, "hi", run_id="chain-1")
    handler.on_chain_end("done", run_id="chain-1")
    handler.flush()


def test_langgraph_forwards_release_onto_ingest_payload():
    calls = []
    handler = langgraph(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
        release="1.8.3",
    )
    handler.on_chain_start({"name": "StateGraph"}, {"topic": "docs"}, run_id="graph-1")
    handler.on_chain_end({"answer": "done"}, run_id="graph-1")
    assert calls[0]["body"]["trace"]["release"] == "1.8.3"


def test_handler_exposes_langchain_callback_flags():
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
    )
    assert handler.run_inline is False
    assert handler.raise_error is False
    assert handler.ignore_llm is False
    assert handler.ignore_chain is False
    assert handler.ignore_agent is False
    assert handler.ignore_retriever is False
    assert handler.ignore_chat_model is False
    assert handler.ignore_retry is False
    assert handler.ignore_custom_event is False


def test_handler_is_langchain_base_callback_handler():
    from langchain_core.callbacks.base import BaseCallbackHandler

    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
    )
    assert isinstance(handler, BaseCallbackHandler)


def _issue_92_history():
    return [{"type": "human", "content": "x" * 4000}, {"type": "ai", "content": "y" * 4000}] * 12


def _issue_92_turn(handler, history):
    import uuid

    root = str(uuid.uuid4())
    handler.on_chain_start(
        {"name": "agent"},
        {"messages": history},
        run_id=root,
        parent_run_id=None,
        metadata={"thread_id": "t"},
    )
    for index in range(11):
        hook_id = str(uuid.uuid4())
        llm_id = str(uuid.uuid4())
        handler.on_chain_start(
            {"name": f"Middleware{index}.awrap_model_call"},
            {"messages": history},
            run_id=hook_id,
            parent_run_id=root,
        )
        handler.on_chat_model_start(
            {
                "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
                "kwargs": {"model": "gpt-4o"},
            },
            [[{"type": "human", "content": "latest"}]],
            run_id=llm_id,
            parent_run_id=hook_id,
        )
        handler.on_llm_end({"generations": [[{"text": "ok"}]]}, run_id=llm_id)
        handler.on_chain_end({"messages": history}, run_id=hook_id, parent_run_id=root)
    handler.on_chain_end({"messages": history}, run_id=root, parent_run_id=None)


def test_exclude_span_names_drops_middleware_hooks_and_nests_children():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
        exclude_span_names=["*.awrap_model_call"],
    )
    history = _issue_92_history()
    _issue_92_turn(handler, history)

    body = calls[0]["body"]
    names = [span["name"] for span in body["trace"]["spans"]]
    assert all("awrap_model_call" not in name for name in names)
    assert names.count("ChatOpenAI") == 11
    assert all(span.get("parent_id") is None for span in body["trace"]["spans"])


def test_include_span_predicate_drops_middleware_hooks():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
        include_span=lambda name: "awrap_model_call" not in name,
    )
    _issue_92_turn(handler, _issue_92_history())

    names = [span["name"] for span in calls[0]["body"]["trace"]["spans"]]
    assert all("awrap_model_call" not in name for name in names)
    assert names.count("ChatOpenAI") == 11


def test_issue_92_filtered_hooks_are_not_a_2mb_post():
    posted = []

    def transport(_url, _headers, body):
        posted.append(body)
        return 201, '{"ok":true}'

    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=transport,
        exclude_span_names=["*.awrap_model_call"],
    )
    _issue_92_turn(handler, _issue_92_history())

    assert posted
    assert len(posted[0]) < 200_000


def test_issue_92_payload_cap_keeps_post_under_budget():
    posted = []

    def transport(_url, _headers, body):
        posted.append(body)
        return 201, '{"ok":true}'

    unfiltered = []

    def measure(_url, _headers, body):
        unfiltered.append(body)
        return 201, '{"ok":true}'

    baseline = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=measure,
    )
    _issue_92_turn(baseline, _issue_92_history())
    assert len(unfiltered[0]) > 1_000_000

    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=transport,
        max_payload_bytes=64_000,
    )
    _issue_92_turn(handler, _issue_92_history())

    assert posted
    assert len(posted[0]) <= 64_000
    payload = json.loads(posted[0].decode())
    assert payload["trace"]["name"]
    assert payload["trace"]["spans"]
    assert any(
        isinstance(span.get("input"), dict) and span["input"].get("__lemma_truncated__")
        for span in payload["trace"]["spans"]
    )


def test_successful_none_outputs_record_explicit_marker():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
        agent_name="ProbeAgent",
    )

    handler.on_chain_start(
        {"name": "agent"},
        {"messages": []},
        run_id="root",
        metadata={"thread_id": "t"},
    )
    handler.on_chain_start({"name": "hook"}, {}, run_id="hook", parent_run_id="root")
    handler.on_chain_end(None, run_id="hook")
    handler.on_tool_start(
        {"name": "log_event"}, "evt-1", run_id="tool", parent_run_id="root"
    )
    handler.on_tool_end(None, run_id="tool")
    handler.on_chain_start(
        {"name": "node_with_state"}, {}, run_id="node", parent_run_id="root"
    )
    handler.on_chain_end({}, run_id="node")
    handler.on_chain_end({"messages": []}, run_id="root")

    spans = {span["name"]: span for span in calls[0]["body"]["trace"]["spans"]}
    assert spans["hook"]["type"] == "span"
    assert spans["hook"]["output"] == {"result": "none"}
    assert spans["log_event"]["type"] == "tool"
    assert spans["log_event"]["output"] == {"result": "none"}
    assert spans["node_with_state"]["output"] == {}
    assert calls[0]["body"]["trace"]["output"] == {"messages": []}


def test_root_none_output_does_not_replace_trace_answer():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start({"name": "agent"}, {"messages": []}, run_id="root")
    handler.on_chain_end(None, run_id="root")

    body = calls[0]["body"]
    assert "output" not in body["trace"] or body["trace"].get("output") in (None, {})


def test_excluded_intermediate_span_keeps_child_under_included_ancestor():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
        exclude_span_names=["Middleware0.awrap_model_call"],
    )

    handler.on_chain_start({"name": "agent"}, {"input": "hi"}, run_id="root")
    handler.on_chain_start(
        {"name": "answer"},
        {"input": "hi"},
        run_id="node",
        parent_run_id="root",
    )
    handler.on_chain_start(
        {"name": "Middleware0.awrap_model_call"},
        {"input": "hi"},
        run_id="hook",
        parent_run_id="node",
    )
    handler.on_chat_model_start(
        {
            "id": ["langchain", "chat_models", "openai", "ChatOpenAI"],
            "kwargs": {"model": "gpt-4o"},
        },
        [[{"type": "human", "content": "hi"}]],
        run_id="llm",
        parent_run_id="hook",
    )
    handler.on_llm_end({"generations": [[{"text": "ok"}]]}, run_id="llm")
    handler.on_chain_end({"output": "ok"}, run_id="hook")
    handler.on_chain_end({"output": "ok"}, run_id="node")
    handler.on_chain_end({"output": "ok"}, run_id="root")

    spans = calls[0]["body"]["trace"]["spans"]
    names = [span["name"] for span in spans]
    assert names == ["answer", "ChatOpenAI"]
    assert spans[1]["parent_id"] == spans[0]["id"]
