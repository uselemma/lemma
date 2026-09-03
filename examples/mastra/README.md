# Mastra

Add `LemmaMastraExporter` to Mastra observability, then run the agent.

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
  agents: { docsAgent },
  observability: new Observability({
    configs: {
      default: { serviceName: "lemma-docs-agent", exporters: [lemmaExporter] },
    },
  }),
});
```

Optional: pass `tracingOptions: { metadata: { threadId, userId } }` on `generate`. Call `lemmaExporter.flush()` in short-lived CLIs.

## Trace shape

```text
lemma-docs-agent
├── list_docs          tool
├── read_doc           tool
└── answer             generation
```
