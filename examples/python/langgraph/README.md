# LangGraph (Python)

Callback handler on `graph.ainvoke()`. Same pattern as LangChain.

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
lemma_handler = langgraph(agent_name="lemma-docs-agent")

await graph.ainvoke(state, {
    "callbacks": [lemma_handler],
    "metadata": {"thread_id": thread_id, "user_id": user_id},
})
```

## Trace shape

```text
lemma-docs-agent
├── agent / tools      spans (graph nodes)
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
