# Vercel AI SDK

Lemma telemetry on `generateText`. Do **not** wrap the run in `lemma.trace()` — `vercelAI()` owns the root trace.

## Run

```bash
cp examples/.env.example examples/.env
pnpm install
pnpm --filter @lemma/example-vercel-ai start "How do I instrument a Vercel AI agent?"
```

Standalone install:

```bash
npm install @uselemma/tracing ai @ai-sdk/openai zod
```

## Instrumentation

```ts
const lemmaTelemetry = vercelAI({
  metadata: { threadId, userId },
});

await generateText({
  // ...
  telemetry: {
    functionId: "lemma-docs-agent",
    integrations: [lemmaTelemetry],
  },
});
await lemmaTelemetry.flush();
```

Create a new `vercelAI()` object for every operation. Concurrent reuse is unsafe.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
