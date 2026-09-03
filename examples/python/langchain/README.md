# LangChain (Python)

Lemma callback handler on a LangChain tool-calling loop. Do **not** wrap the run in `lemma.trace()` — `langchain()` owns the root trace.

## Run

```bash
cp examples/.env.example examples/.env
uv sync
uv run --project examples/python/langchain python examples/python/langchain/main.py \
  "How do I instrument LangChain?"
```

Standalone install:

```bash
pip install "uselemma-tracing[langchain]" langchain-openai
```

## Instrumentation

```python
lemma_handler = langchain(
    agent_name="lemma-docs-agent",
    thread_id_key="thread_id",
    user_id_key="user_id",
)

await model.ainvoke(messages, config={
    "callbacks": [lemma_handler],
    "metadata": {"thread_id": thread_id, "user_id": user_id},
})
lemma_handler.flush()
```

Invoke tools through LangChain (`tool.ainvoke`) so tool callbacks show up as Lemma tool spans.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
