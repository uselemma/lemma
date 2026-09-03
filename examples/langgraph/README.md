# LangGraph

Callback handler on `graph.invoke()`. Same pattern as LangChain.

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
const lemmaHandler = langGraph({ agentName: "lemma-docs-agent" });

await graph.invoke(state, {
  callbacks: langChainCallbacks(lemmaHandler),
  metadata: { threadId, userId },
});
```

`@uselemma/tracing` is framework-free, so `langGraph()` is duck-typed. The example's `langChainCallbacks()` helper asserts it to LangChain's `Callbacks` type (`BaseCallbackHandler` lives in `@langchain/core`, which the published SDK does not import).

## Trace shape

```text
lemma-docs-agent
├── agent / tools      spans (graph nodes)
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
