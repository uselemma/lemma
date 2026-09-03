# Python docs-agent examples

Same agent as the TypeScript examples: a CLI that answers Lemma questions from [the live docs](https://docs.uselemma.ai/llms.txt). Pick the folder that matches your stack.

| Folder | Lemma wiring |
| --- | --- |
| [`direct-sdk`](direct-sdk) | `lemma.async_trace()` |
| [`openai-agents`](openai-agents) | `instrument_openai_agents()` |
| [`langchain`](langchain) | `langchain()` callbacks |
| [`langgraph`](langgraph) | `langgraph()` callbacks |

Credentials live in [`../.env.example`](../.env.example). From the repo root:

```bash
uv sync
uv run --project examples/python/direct-sdk python examples/python/direct-sdk/main.py \
  "How do I instrument a Python agent with Lemma?"
```

Vercel AI SDK and Mastra are TypeScript-only; see [`../vercel-ai`](../vercel-ai) and [`../mastra`](../mastra).
