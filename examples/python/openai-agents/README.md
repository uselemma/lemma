# OpenAI Agents SDK (Python)

Register the Lemma processor once, then run the agent.

## Run

```bash
cp examples/.env.example examples/.env
uv sync
uv run --project examples/python/openai-agents python examples/python/openai-agents/main.py \
  "How do I instrument OpenAI Agents?"
```

Standalone install:

```bash
pip install "uselemma-tracing[openai-agents]" openai-agents
```

## Instrumentation

```python
instrument_openai_agents()

result = await Runner.run(agent, message)
```

Optional: wrap with `trace(..., group_id=thread_id)` so the Agents SDK session id becomes Lemma `thread_id` (same grouping API Langfuse uses). Call `processor.force_flush()` in short-lived CLIs.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
