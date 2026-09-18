from helpers import PROJECT_ID, make_transport
from uselemma_tracing import langchain
from uselemma_tracing.langchain import root_trace_output

BEDROCK_REASONING_BLOCKS = [
    {
        "type": "reasoning_content",
        "reasoning_content": {"text": "internal chain of thought"},
    },
    {"type": "text", "text": "Your cortisol is elevated."},
]


def test_reasoning_content_blocks_flatten_to_text_for_root_output():
    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )

    handler.on_chain_start(
        {"name": "agent"},
        {"messages": [{"type": "human", "content": "hi"}]},
        run_id="root",
        metadata={"thread_id": "t"},
    )
    handler.on_llm_start(
        {
            "id": [
                "langchain_aws",
                "chat_models",
                "bedrock_converse",
                "ChatBedrockConverse",
            ],
            "kwargs": {"model": "claude-sonnet-4"},
        },
        [[{"type": "human", "content": "hi"}]],
        run_id="llm-1",
        parent_run_id="root",
    )
    handler.on_llm_end(
        {
            "generations": [
                [{"message": {"type": "ai", "content": BEDROCK_REASONING_BLOCKS}}]
            ]
        },
        run_id="llm-1",
    )
    handler.on_chain_end(
        {
            "messages": [
                {"type": "human", "content": "hi"},
                {"type": "ai", "content": BEDROCK_REASONING_BLOCKS},
            ]
        },
        run_id="root",
    )

    body = calls[0]["body"]
    assert body["trace"]["output"] == "Your cortisol is elevated."
    assert body["trace"]["spans"][0]["output"] == BEDROCK_REASONING_BLOCKS


def test_github_90_flattens_aimessage_reasoning_content_blocks():
    from langchain_core.messages import AIMessage, HumanMessage

    calls = []
    handler = langchain(
        api_key="key",
        project_id=PROJECT_ID,
        transport=make_transport(calls),
    )
    answer = AIMessage(content=BEDROCK_REASONING_BLOCKS)
    handler.on_chain_start(
        {"name": "agent"},
        {"messages": [HumanMessage("hi")]},
        run_id="root",
        metadata={"thread_id": "t"},
    )
    handler.on_chain_end(
        {"messages": [HumanMessage("hi"), answer]},
        run_id="root",
    )

    assert calls[0]["body"]["trace"]["output"] == "Your cortisol is elevated."


def test_root_trace_output_joins_text_blocks_and_skips_reasoning_shapes():
    assert (
        root_trace_output(
            {
                "messages": [
                    {"type": "human", "content": "hi"},
                    {"type": "ai", "content": BEDROCK_REASONING_BLOCKS},
                ]
            }
        )
        == "Your cortisol is elevated."
    )
    assert (
        root_trace_output(
            {
                "messages": [
                    {
                        "type": "ai",
                        "content": [
                            {"type": "thinking", "thinking": "let me think"},
                            {"type": "text", "text": "Done."},
                        ],
                    }
                ]
            }
        )
        == "Done."
    )
    assert (
        root_trace_output(
            [
                {
                    "type": "reasoning",
                    "summary": [{"type": "summary_text", "text": "plan"}],
                },
                {"type": "text", "text": "Shipped yesterday."},
            ]
        )
        == "Shipped yesterday."
    )
    assert (
        root_trace_output(
            {
                "messages": [
                    {
                        "type": "ai",
                        "content": [
                            {"type": "text", "text": "Line one."},
                            {"type": "text", "text": "Line two."},
                        ],
                    }
                ]
            }
        )
        == "Line one.\nLine two."
    )


def test_root_trace_output_keeps_plain_string_tool_calls_and_reasoning_only():
    assert root_trace_output("It arrives Friday.") == "It arrives Friday."
    tool_calls = [{"id": "call_1", "name": "lookup", "args": {}}]
    assert root_trace_output(
        {
            "role": "assistant",
            "content": BEDROCK_REASONING_BLOCKS,
            "tool_calls": tool_calls,
        }
    ) == {
        "role": "assistant",
        "content": BEDROCK_REASONING_BLOCKS,
        "tool_calls": tool_calls,
    }
    assert root_trace_output(
        {
            "messages": [
                {
                    "type": "ai",
                    "content": BEDROCK_REASONING_BLOCKS,
                    "tool_calls": tool_calls,
                }
            ]
        }
    ) == {
        "role": "assistant",
        "content": BEDROCK_REASONING_BLOCKS,
        "tool_calls": tool_calls,
    }
    reasoning_only = [
        {
            "type": "reasoning_content",
            "reasoning_content": {"text": "internal chain of thought"},
        }
    ]
    assert (
        root_trace_output({"messages": [{"type": "ai", "content": reasoning_only}]})
        == reasoning_only
    )
    assert root_trace_output({"answer": BEDROCK_REASONING_BLOCKS}) == (
        "Your cortisol is elevated."
    )
    assert root_trace_output({"result": {"content": BEDROCK_REASONING_BLOCKS}}) == (
        "Your cortisol is elevated."
    )
