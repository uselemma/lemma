# Mastra

Lemma exporter on Mastra observability. Do **not** wrap `agent.generate()` in `lemma.trace()` — `LemmaMastraExporter` creates one root per Mastra run.

Pass `threadId` / `userId` on `tracingOptions.metadata`.

## Run

```bash
cp examples/.env.example examples/.env
pnpm install
pnpm --filter @lemma/example-mastra start "How do I instrument Mastra?"
```

Standalone install:

```bash
npm install @uselemma/tracing @mastra/core @mastra/observability
```

## Instrumentation

```ts
const lemmaExporter = new LemmaMastraExporter({ agentName: "lemma-docs-agent" });

new Mastra({
  observability: new Observability({
    configs: {
      default: { serviceName: "lemma-docs-agent", exporters: [lemmaExporter] },
    },
  }),
});

await agent.generate(messages, {
  tracingOptions: { metadata: { threadId, userId } },
});
await lemmaExporter.flush();
```

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
