# Audit local instrumentation

Read-only. Do not create, edit, or delete files.

## Confirm traces exist

Call `has_ready_traces` with `project_id`. If that is false or the tool
is unavailable, call `list_dashboard_traces` with `project_id`.

- Ready traces exist: continue.
- No traces, empty list, or MCP disconnected: stop. Tell the user to use
  `lemma-tracing` for setup and delivery. Do not enable debug mode, do not
  suggest `LEMMA_DEBUG`, and do not call ingest-status tools.

## Detect the harness

Inspect imports, startup files, agent handlers, and model/tool call sites.
Do not modify them.

| Signal | How to detect |
| --- | --- |
| Lemma SDK already present | `@uselemma/tracing`, `uselemma_tracing`, `Lemma`, `vercelAI`, `lemma.trace` |
| Agent boundary | request handler, job processor, CLI command, workflow step, streaming route |
| Vercel AI SDK | `generateText`, `streamText`, `generateObject`, `tool`, `telemetry`, `experimental_telemetry` from `ai` |
| OpenAI Agents SDK | `@openai/agents`, `openai-agents`, `Agent`, `Runner`, `run`, `addTraceProcessor` |
| LangChain | `langchain`, `@langchain/*`, `ChatOpenAI`, chains, callbacks |
| LangGraph | `langgraph`, `@langchain/langgraph`, graph `invoke`/`stream`, callbacks |
| Mastra | `@mastra/core`, `@mastra/observability`, `new Mastra(...)`, `Observability`, `agent.generate` |
| Model call | `openai`, `anthropic`, provider adapters, AI SDK model calls |
| Tool call | functions passed as tools, MCP calls, retrieval/search/order/payment helpers |
| Existing tracing | Langfuse, OpenTelemetry, OpenInference, Arize/Phoenix, Braintrust |

Ask one focused clarification question only when the agent boundary is
genuinely ambiguous.

## Name the supported path

Match what you found to a first-wave path from [SKILL.md](../SKILL.md).
Recommend that adapter. Do not recommend forwarding generic OTLP.

If nothing matches, say so and plan a direct `@uselemma/tracing` /
`uselemma-tracing` integration. Do not invent a framework helper.

Then continue to [verify.md](verify.md).
