# Direct SDK (no framework)

Manual Lemma instrumentation around an OpenAI tool loop. Use this when you are not on Vercel AI, OpenAI Agents, LangChain, LangGraph, or Mastra.

## Run

From the repo root:

```bash
cp examples/.env.example examples/.env   # then fill in keys
pnpm install
pnpm --filter @lemma/example-direct-sdk start "How do I instrument a Vercel AI agent?"
```

REPL:

```bash
pnpm --filter @lemma/example-direct-sdk start
```

In a standalone app you would install the published package instead of the workspace link:

```bash
npm install @uselemma/tracing openai
```

## Instrumentation

```ts
return lemma.trace(
  { name: "lemma-docs-agent", input: turn.message, threadId, userId },
  async (trace) => {
    trace.recordGeneration({ name: "answer", model, input: prompt, output });
    trace.recordTool({ name: "list_docs", input, output });
    return answer;
  },
);
```

Each REPL turn is a new root trace. Turns in the same session share `threadId`.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
