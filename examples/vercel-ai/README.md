# Vercel AI SDK

Pass `vercelAI()` on `generateText` telemetry.

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
const lemmaTelemetry = vercelAI({ metadata: { threadId, userId } });

await generateText({
  model,
  tools,
  telemetry: {
    functionId: "lemma-docs-agent",
    integrations: [lemmaTelemetry],
  },
});
```

Create one `vercelAI()` per `generateText` call. Call `flush()` in short-lived CLIs.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
