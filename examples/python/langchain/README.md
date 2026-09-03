# LangChain (Python)

Lemma callback handler on a LangChain `create_agent` invoke. Do **not** wrap the run in `lemma.trace()` — `langchain()` owns the root trace. One `agent.ainvoke()` is one root.

## Run

```bash
cp examples/.env.example examples/.env
uv sync
uv run --project examples/python/langchain python examples/python/langchain/main.py \
  "How do I instrument LangChain?"
```

Standalone install:

```bash
pip install "uselemma-tracing[langchain]" langchain langchain-openai
```

## Instrumentation

```python
lemma_handler = langchain(
    agent_name="lemma-docs-agent",
    thread_id_key="thread_id",
    user_id_key="user_id",
)

agent = create_agent(model=ChatOpenAI(model="gpt-4o-mini"), tools=tools, system_prompt=system_prompt)

await agent.ainvoke(
    {"messages": messages},
    {
        "callbacks": [lemma_handler],
        "metadata": {"thread_id": thread_id, "user_id": user_id},
    },
)
lemma_handler.flush()
```

Use `create_agent` (one invoke per turn) so LangChain callbacks nest under a single root. A manual `model.ainvoke` / `tool.ainvoke` loop creates one owned trace per call.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
