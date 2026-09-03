# OpenAI Agents SDK

Lemma trace processor on OpenAI Agents. Do **not** wrap `run()` in `lemma.trace()` — `openAIAgents()` creates the root from Agents SDK events.

`groupId` on `withTrace(...)` becomes Lemma `threadId`.

## Run

```bash
cp examples/.env.example examples/.env
pnpm install
pnpm --filter @lemma/example-openai-agents start "How do I instrument OpenAI Agents?"
```

Standalone install:

```bash
npm install @uselemma/tracing @openai/agents
```

## Instrumentation

```ts
const processor = openAIAgents();
addTraceProcessor(processor);

await withTrace(AGENT_NAME, () => run(agent, input), {
  groupId: threadId,
  metadata: { userId },
});
await processor.forceFlush();
```

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
