# OpenAI Agents SDK

Register the Lemma processor once, then run the agent.

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

const result = await run(agent, input);
```

Optional: wrap with `withTrace(..., { groupId })` so the Agents SDK session id becomes Lemma `threadId` (same grouping API Langfuse uses). Call `processor.forceFlush()` in short-lived CLIs.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
