import json

from uselemma_tracing import langchain, langgraph


def make_transport(calls):
    def transport(url, headers, body):
        calls.append(
            {
                "url": url,
                "headers": headers,
                "body": json.loads(body.decode()),
            }
        )
        return 201, "{}"

    return transport


def test_langchain_records_generation_retriever_and_tool_children():
    calls = []
    handler = langchain(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
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


def test_standalone_chat_model_finalizes_one_owned_trace():
    calls = []
    handler = langchain(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
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
        project_id="10000000-0000-0000-0000-000000000001",
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
        project_id="10000000-0000-0000-0000-000000000001",
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


def test_langchain_records_errors():
    calls = []
    handler = langchain(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
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
    assert body["trace"]["error"] == "agent failed"
    assert body["trace"]["spans"][0]["status"] == "ERROR"
    assert body["trace"]["spans"][0]["error"] == "lookup failed"
    assert "output" not in body["trace"]["spans"][0]


def test_langchain_records_is_error_tool_end_as_error_without_output():
    calls = []
    handler = langchain(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
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


def test_privacy_flags_strip_payloads_keep_structure():
    calls = []
    handler = langchain(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
        transport=make_transport(calls),
        record_inputs=False,
        record_outputs=False,
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
    assert body["trace"].get("input") in (None, {})
    assert body["trace"]["error"] == "error"
    assert body["trace"]["spans"][0]["type"] == "generation"
    assert body["trace"]["spans"][0]["model"] == "gpt-4o"
    assert body["trace"]["spans"][0].get("input") in (None, {})
    assert body["trace"]["spans"][0].get("output") in (None, {})
    assert body["trace"]["spans"][1]["status"] == "ERROR"
    assert body["trace"]["spans"][1].get("input") in (None, {})
    assert body["trace"]["spans"][1].get("output") in (None, {})


def test_message_normalization_and_provider_from_class():
    calls = []
    handler = langchain(
        api_key="key",
        project_id="10000000-0000-0000-0000-000000000001",
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
        project_id="10000000-0000-0000-0000-000000000001",
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
        project_id="10000000-0000-0000-0000-000000000001",
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
        project_id="10000000-0000-0000-0000-000000000001",
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
