# LangChain

Callback handler on a LangChain `createAgent` invoke. One `agent.invoke()` is one root.

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
const lemmaHandler = langChain({ agentName: "lemma-docs-agent" });

await agent.invoke(
  { messages },
  { callbacks: langChainCallbacks(lemmaHandler), metadata: { threadId, userId } },
);
```

`@uselemma/tracing` is framework-free, so `langChain()` is duck-typed. The example's `langChainCallbacks()` helper asserts it to LangChain's `Callbacks` type (`BaseCallbackHandler` lives in `@langchain/core`, which the published SDK does not import).

`threadId` / `userId` are read from invoke metadata by default. Call `lemmaHandler.flush()` in short-lived CLIs so the last ingest finishes.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
