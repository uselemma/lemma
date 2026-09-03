# Lemma Codex plugin

This local Codex plugin sends one complete Lemma trace when each user turn
finishes. It uses Codex lifecycle hooks directly; it does not run an MCP
server and it does not wait for the Codex session or chat window to close.

Each trace contains the user prompt, final assistant response, tool arguments,
tool results, model, working directory, and transcript path. The Codex
`session_id` is the Lemma `thread_id`, so separate turn traces appear as one
conversation.

## Local setup

From this repository checkout:

```bash
pnpm --filter @uselemma/codex-plugin build
node plugins/lemma-codex/scripts/setup.mjs
```

For Lemma's development environment:

```bash
node plugins/lemma-codex/scripts/setup.mjs --api-url https://dev.api.uselemma.ai
```

Setup adds this checkout as the `lemma-local` Codex marketplace, installs the
plugin from `./plugins/lemma-codex`, starts a browser login, stores the
resulting project-scoped ingest credential, and configures Codex's
`agent-turn-complete` notifier. The approval page chooses the Lemma project.
No general Lemma API key is issued. If `notify` is already configured, Lemma
forwards every notification to the existing command.

Codex treats hook commands as executable code. On first use, review and trust
the three Lemma hooks in `/hooks`. This local trust step is separate from any
future public plugin-catalog review.

## Delivery behavior

- `UserPromptSubmit` opens a serializable turn.
- `PreToolUse` and `PostToolUse` append full tool context.
- Codex's `agent-turn-complete` notification closes and queues the turn only
  after every `Stop` hook has settled without requesting continuation.
- Transcript repair and network delivery run outside hook timeouts.
- A failed delivery stays on disk and retries on the next prompt or completed
  turn.
- Duplicate delivery is safe because trace and span IDs remain stable.
- Explicit subagent events are ignored in v1.

State and credentials use an OS-specific private application-data directory.
Set `LEMMA_CODEX_DATA_DIR` to override it. Files are written atomically, and
POSIX credentials use mode `0600`.

## Development

```bash
pnpm --filter @uselemma/codex-plugin type-check
pnpm --filter @uselemma/codex-plugin test
pnpm --filter @uselemma/codex-plugin build
```

The generated `runtime/` and `scripts/` bundles are not committed. Build
them before setup, tests that read the runtime, or a local Codex install
(Codex copies only this plugin directory).
