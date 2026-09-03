# LangChain

Lemma callback handler on a LangChain `createAgent` invoke. Do **not** wrap the run in `lemma.trace()` — `langChain()` owns the root trace. One `agent.invoke()` is one root.

## Run

```bash
cp examples/.env.example examples/.env
pnpm install
pnpm --filter @lemma/example-langchain start "How do I instrument LangChain?"
```

Standalone install:

```bash
npm install @uselemma/tracing langchain @langchain/core @langchain/openai
```

## Instrumentation

```ts
const lemmaHandler = langChain({
  agentName: "lemma-docs-agent",
  threadIdKey: "threadId",
  userIdKey: "userId",
});

const agent = createAgent({
  model: new ChatOpenAI({ model: "gpt-4o-mini" }),
  tools,
  systemPrompt,
});

await agent.invoke(
  { messages },
  {
    callbacks: [lemmaHandler],
    metadata: { threadId, userId },
  },
);
await lemmaHandler.flush();
```

Use `createAgent` (one invoke per turn) so LangChain callbacks nest under a single root. A manual `model.invoke` / `tool.invoke` loop creates one owned trace per call.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
