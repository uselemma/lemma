# Lemma docs-agent examples

The same chat agent, instrumented once per first-party stack. Each folder answers questions about Lemma by reading [the live docs](https://docs.uselemma.ai/llms.txt). Open the folder that matches your framework and copy the tracing setup.

SDK-level API snippets still live next to the packages: [`packages/ts/tracing/examples`](../packages/ts/tracing/examples) and [`packages/py/tracing/examples`](../packages/py/tracing/examples). Those are not runnable agents.

Harness plugins (Claude Code, Cursor, Codex, Hermes, OpenClaw, OpenCode, Pi) are not in this directory. They instrument an existing coding harness rather than an agent you build.

## Credentials

```bash
cp examples/.env.example examples/.env
```

Fill in `LEMMA_API_KEY`, `LEMMA_PROJECT_ID`, and `OPENAI_API_KEY`. Optional: `LEMMA_RELEASE`, `LEMMA_USER_ID`, `LEMMA_DEBUG=1`.

Then `pnpm install` and `uv sync` from the repo root.

## TypeScript

| Folder | When to use | Lemma wiring |
| --- | --- | --- |
| [`direct-sdk`](direct-sdk) | No agent framework | `lemma.trace()` + `recordTool` / `recordGeneration` |
| [`vercel-ai`](vercel-ai) | Vercel AI SDK | `vercelAI()` on `generateText` telemetry |
| [`openai-agents`](openai-agents) | OpenAI Agents SDK | `openAIAgents()` processor |
| [`langchain`](langchain) | LangChain | `langChain()` callback handler |
| [`langgraph`](langgraph) | LangGraph | `langGraph()` callback handler |
| [`mastra`](mastra) | Mastra | `LemmaMastraExporter` |

```bash
pnpm --filter @lemma/example-direct-sdk start "How do I instrument a Vercel AI agent?"
pnpm --filter @lemma/example-direct-sdk start   # REPL
```

Adapters own the root — pass the handler, processor, exporter, or telemetry helper. Use `lemma.trace()` only in the no-framework folders.

## Python

| Folder | When to use | Lemma wiring |
| --- | --- | --- |
| [`python/direct-sdk`](python/direct-sdk) | No agent framework | `lemma.async_trace()` + `record_tool` / `record_generation` |
| [`python/openai-agents`](python/openai-agents) | OpenAI Agents SDK | `instrument_openai_agents()` |
| [`python/langchain`](python/langchain) | LangChain | `langchain()` callback handler |
| [`python/langgraph`](python/langgraph) | LangGraph | `langgraph()` callback handler |

```bash
uv run --project examples/python/direct-sdk python examples/python/direct-sdk/main.py \
  "How do I instrument a Python agent with Lemma?"
```

## Agent contract

Every example is `lemma-docs-agent`:

- Tools: `list_docs` (fetches `https://docs.uselemma.ai/llms.txt`) and `read_doc` (fetches a `.md` docs page)
- Model: `gpt-4o-mini` via `OPENAI_API_KEY`
- One root trace per user turn, shared `threadId` / `thread_id` for the REPL session

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```

After a turn, open [Traces](https://platform.uselemma.ai) and confirm that shape. See [Runnable examples](https://docs.uselemma.ai/guides/examples) in the docs.
