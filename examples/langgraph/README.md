# LangGraph

Lemma callback handler on a LangGraph tool-calling graph. Do **not** wrap `graph.invoke()` in `lemma.trace()` — `langGraph()` owns the root trace.

Graph nodes show up as nested spans; model calls are generations; tools are tool spans.

## Run

```bash
cp examples/.env.example examples/.env
pnpm install
pnpm --filter @lemma/example-langgraph start "How do I instrument LangGraph?"
```

Standalone install:

```bash
npm install @uselemma/tracing @langchain/langgraph @langchain/openai
```

## Instrumentation

```ts
const lemmaHandler = langGraph({
  agentName: "lemma-docs-agent",
  threadIdKey: "threadId",
  userIdKey: "userId",
});

await graph.invoke(state, {
  callbacks: [lemmaHandler],
  metadata: { threadId, userId },
});
await lemmaHandler.flush();
```

## Trace shape

```text
lemma-docs-agent
├── agent / tools      spans (graph nodes)
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
