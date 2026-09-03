# Lemma for Hermes Agent

This package installs a native Hermes plugin that captures each completed agent
turn and delivers one complete trace through the Lemma SDK. It does not install
an MCP server, a Lemma skill, or a generic OTLP exporter.

## Install

```bash
pnpm dlx @uselemma/hermes setup
```

The setup flow opens Lemma, asks you to choose one project, stores the returned
project-scoped credential under `~/.hermes/lemma/credentials.json`, and installs
the plugin at `~/.hermes/plugins/lemma`. Setup enables only the `lemma` plugin
through Hermes's own plugin command and explicitly denies built-in tool override
permission.

Pass `--data-dir PATH` to store credentials and pending traces elsewhere. Setup
records that absolute location under `~/.hermes/lemma` so later Hermes processes
find it without requiring an environment variable.

Restart Hermes after the first install. Re-running setup updates only the Lemma
plugin directory and rotates the scoped credential; unrelated Hermes plugins and
configuration are left unchanged.

Use development endpoints while testing locally:

```bash
pnpm dlx @uselemma/hermes setup --api-url https://dev.api.uselemma.ai
```

Trace delivery is bounded to ten seconds and runs in a detached process after
the Hermes turn ends. Failed deliveries remain in `~/.hermes/lemma/pending` for
the next turn to retry, and never block the agent loop.

Generated `scripts/` and `hermes-plugin/lemma/runtime/` are not committed.
Build them with `pnpm --filter @uselemma/hermes build` before tests or pack.

