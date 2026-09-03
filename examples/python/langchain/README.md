# LangChain (Python)

Callback handler on a LangChain `create_agent` invoke. One `agent.ainvoke()` is one root.

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
lemma_handler = langchain(agent_name="lemma-docs-agent")

await agent.ainvoke(
    {"messages": messages},
    {"callbacks": [lemma_handler], "metadata": {"thread_id": thread_id, "user_id": user_id}},
)
```

`thread_id` / `user_id` are read from invoke metadata by default. Call `lemma_handler.flush()` in short-lived CLIs so the last ingest finishes.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
