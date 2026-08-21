# Lemma for Pi

`@uselemma/pi` sends completed Pi coding-agent turns to Lemma through the Lemma SDK ingest endpoint. It does not install MCP servers, Lemma skills, an investigation CLI, or an OTLP exporter.

## Install

```bash
pi install npm:@uselemma/pi
pnpm dlx @uselemma/pi setup
```

The setup command opens Lemma's scoped coding-harness authorization page, lets you choose one project, and stores the returned scoped credential at `~/.pi/agent/lemma/credentials.json` with private file permissions. Run the same command again to reconnect or rotate it.

## Pi CLI sessions

The installed extension records Pi's prompt, model, and tool lifecycle events and sends one complete trace after the agent is fully settled, including automatic retries, compaction retries, and queued continuations. Current Pi CLI releases do not expose an `@earendil-works/pi-telemetry` context to extensions, so the package uses Pi's native extension events as a compatibility bridge for CLI sessions.

## Pi AgentHarness sessions

Pi applications that construct `AgentHarness` can use the telemetry interface directly:

```ts
import { AgentHarness } from "@earendil-works/pi-agent-core";
import { createLemmaPiTelemetryContext } from "@uselemma/pi";

const { harness } = await AgentHarness.create({
  // Pi session, model, tools, and resources...
  context: createLemmaPiTelemetryContext(),
});
```

The exporter maps `pi.ai.request` spans to Lemma generations, `pi.harness.tool` spans to Lemma tools, and other Pi telemetry spans to regular SDK spans. It posts only to `/traces/ingest`.
