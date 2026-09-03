# Direct SDK (Python, no framework)

Manual Lemma instrumentation around an OpenAI tool loop. Use this when you are not on OpenAI Agents, LangChain, or LangGraph.

## Run

```bash
cp examples/.env.example examples/.env
uv sync
uv run --project examples/python/direct-sdk python examples/python/direct-sdk/main.py \
  "How do I instrument a Python agent with Lemma?"
```

Standalone install:

```bash
pip install uselemma-tracing openai
```

## Instrumentation

```python
return await lemma.async_trace(
    "lemma-docs-agent",
    run,
    input=message,
    thread_id=thread_id,
    user_id=user_id,
)
```

Record generations with `trace.record_generation(...)` and tools with `trace.record_tool(...)`. Each REPL turn is a new root; turns in the same session share `thread_id`.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
