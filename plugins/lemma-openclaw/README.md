# Lemma for OpenClaw

This package installs a native OpenClaw plugin that captures completed agent
turns and tool calls, then delivers one complete trace through the Lemma SDK. It
does not install an MCP server, skill, or generic OTLP exporter.

## Install

```bash
pnpm dlx @uselemma/openclaw setup
```

Setup opens Lemma, asks you to choose one project, stores the returned
project-scoped credential under the active OpenClaw state directory, and runs
OpenClaw's own plugin installer. It also enables the required
`plugins.entries.lemma.hooks.allowConversationAccess` policy because OpenClaw
blocks raw conversation hooks for untrusted third-party plugins by default.

OpenClaw uses `~/.openclaw` by default and continues to support an existing
legacy `~/.clawdbot` state directory. Pass `--state-dir PATH` to target an
isolated OpenClaw state directory. Pass `--data-dir PATH` to store Lemma
credentials and pending traces elsewhere; setup records that absolute location
so later OpenClaw processes find it without another environment variable.

Restart the OpenClaw Gateway after installation. Re-running setup rotates the
scoped credential and safely reinstalls only the Lemma plugin through
`openclaw plugins install --force`; unrelated plugins and configuration remain
unchanged.

Use development endpoints while testing locally:

```bash
pnpm dlx @uselemma/openclaw setup --api-url https://dev.api.uselemma.ai
```

Trace delivery is bounded to ten seconds and runs in a detached process after
the agent turn ends. Failed deliveries remain in the OpenClaw Lemma data
directory for the next turn to retry and never interrupt the agent loop.

Generated `runtime/` and `scripts/` are not committed. Build them with
`pnpm --filter @uselemma/openclaw build` before tests or pack.

