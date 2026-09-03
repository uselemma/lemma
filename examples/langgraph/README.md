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
  callbacks: [lemmaHandler],
  metadata: { threadId, userId },
});
```

## Trace shape

```text
lemma-docs-agent
├── agent / tools      spans (graph nodes)
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
