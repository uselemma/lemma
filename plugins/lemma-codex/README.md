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
plugin from `./plugins/lemma-codex`, starts a browser login, and stores the
resulting project-scoped ingest credential. The approval page chooses the
Lemma project. No general Lemma API key is issued.

Codex treats hook commands as executable code. On first use, review and trust
the four Lemma hooks in `/hooks`. This local trust step is separate from any
future public plugin-catalog review.

## Delivery behavior

- `UserPromptSubmit` opens a serializable turn.
- `PreToolUse` and `PostToolUse` append full tool context.
- `Stop` completes and queues the turn before attempting network delivery.
- A failed delivery stays on disk and retries on the next prompt or Stop.
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

The generated `runtime/hook.mjs` and `scripts/setup.mjs` are committed because
Codex copies only the plugin directory during local installation.
