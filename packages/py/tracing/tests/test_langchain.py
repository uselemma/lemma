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
        metadata={"thread_id": "thread-1"},
        name="support-agent",
    )
    handler.on_llm_start(
        {"id": ["langchain", "chat_models", "ChatOpenAI"], "kwargs": {"model": "gpt-4o"}},
        ["where is my order?"],
        run_id="llm-1",
        parent_run_id="chain-1",
    )
    handler.on_llm_end(
        {
            "generations": [[{"text": "I should search docs."}]],
        },
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
    assert body["trace"]["input"] == {"input": "where is my order?"}
    assert body["trace"]["output"] == {"answer": "It arrives Friday."}
    assert body["trace"]["metadata"] == {
        "thread_id": "thread-1",
        "langchain_run_id": "chain-1",
    }

    generation, retriever, tool = body["trace"]["spans"]
    assert generation["name"] == "ChatOpenAI"
    assert generation["type"] == "generation"
    assert generation["input"] == ["where is my order?"]
    assert generation["output"] == "I should search docs."
    assert generation["model"] == "gpt-4o"
    assert retriever["name"] == "VectorStoreRetriever"
    assert retriever["type"] == "span"
    assert retriever["output"] == [{"page_content": "Shipping docs"}]
    assert tool["name"] == "search_docs"
    assert tool["type"] == "tool"
    assert tool["output"] == [{"title": "Shipping"}]


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
    handler.on_chain_end({"answer": "done"}, run_id="graph-1")

    body = calls[0]["body"]
    assert body["trace"]["name"] == "langgraph-agent"
    assert body["trace"]["input"] == {"topic": "docs"}
    assert body["trace"]["output"] == {"answer": "done"}
    assert body["trace"]["spans"][0]["name"] == "retrieve"
    assert body["trace"]["spans"][0]["output"] == {"docs": ["one"]}
