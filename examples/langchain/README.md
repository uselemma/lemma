# LangChain

Lemma callback handler on a LangChain tool-calling loop. Do **not** wrap the run in `lemma.trace()` — `langChain()` owns the root trace.

## Run

```bash
cp examples/.env.example examples/.env
pnpm install
pnpm --filter @lemma/example-langchain start "How do I instrument LangChain?"
```

Standalone install:

```bash
npm install @uselemma/tracing @langchain/core @langchain/openai
```

## Instrumentation

```ts
const lemmaHandler = langChain({
  agentName: "lemma-docs-agent",
  threadIdKey: "threadId",
  userIdKey: "userId",
});

await model.invoke(messages, {
  callbacks: [lemmaHandler],
  metadata: { threadId, userId },
});
await lemmaHandler.flush();
```

Invoke tools through LangChain (`tool.invoke`) so tool callbacks show up as Lemma tool spans.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
