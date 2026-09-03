# LangGraph (Python)

Lemma callback handler on a LangGraph tool-calling graph. Do **not** wrap `graph.ainvoke()` in `lemma.trace()` — `langgraph()` owns the root trace.

Graph nodes show up as nested spans; model calls are generations; tools are tool spans.

## Run

```bash
cp examples/.env.example examples/.env
uv sync
uv run --project examples/python/langgraph python examples/python/langgraph/main.py \
  "How do I instrument LangGraph?"
```

Standalone install:

```bash
pip install "uselemma-tracing[langgraph]" langgraph langchain-openai
```

## Instrumentation

```python
lemma_handler = langgraph(
    agent_name="lemma-docs-agent",
    thread_id_key="thread_id",
    user_id_key="user_id",
)

await graph.ainvoke(state, {
    "callbacks": [lemma_handler],
    "metadata": {"thread_id": thread_id, "user_id": user_id},
})
lemma_handler.flush()
```

## Trace shape

```text
lemma-docs-agent
├── agent / tools      spans (graph nodes)
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
