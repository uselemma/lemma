# OpenAI Agents SDK (Python)

Lemma processor on OpenAI Agents. Do **not** wrap `Runner.run` in `lemma.trace()` — `instrument_openai_agents()` creates the root from Agents SDK events.

`group_id` on `trace(...)` becomes Lemma `thread_id`.

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
processor = instrument_openai_agents()

with trace("lemma-docs-agent", group_id=thread_id, metadata={"user_id": user_id}):
    result = await Runner.run(agent, message)
processor.force_flush()
```

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
