# Lemma Cursor plugin

This Cursor plugin sends one complete Lemma trace when each user prompt
finishes. It uses Cursor lifecycle hooks directly and does not run an MCP
server or install rules or skills.

Each trace contains the prompt, final assistant response, tool arguments,
tool results, model metadata, working directory, workspace roots, and
transcript path. Cursor's `conversation_id` becomes the Lemma `thread_id`, and
`generation_id` identifies one completed trace within that conversation.

## Local setup

From this repository checkout:

```bash
pnpm --filter @uselemma/cursor-plugin build
node plugins/lemma-cursor/scripts/setup.mjs
```

For Lemma's development environment:

```bash
node plugins/lemma-cursor/scripts/setup.mjs --api-url https://dev.api.uselemma.ai
```

Setup installs this checkout at `~/.cursor/plugins/local/lemma-cursor`, opens
project selection in the browser, and stores the resulting project-scoped
ingest credential. Local plugin installation itself does not require a paid
Cursor plan. Running Cursor Agent still requires a signed-in Cursor account,
available Cursor usage, or another model path supported by Cursor.

## Delivery behavior

- `beforeSubmitPrompt` starts one turn using Cursor's stable generation ID.
- `preToolUse`, `postToolUse`, and `postToolUseFailure` correlate tools by
  `tool_use_id`.
- `afterAgentResponse` stores the final assistant response.
- `stop` closes and queues the trace.
- Scripted `cursor agent --print` sessions omit prompt/response hooks, so
  `sessionEnd` reconstructs their prompt and final response from Cursor's
  transcript while preserving any tool hooks emitted during the run.
- Network delivery runs outside the hook timeout.
- Failed delivery remains on disk and retries on the next prompt or completion.
- Deterministic trace IDs make duplicate delivery safe.

State and credentials use an OS-specific private application-data directory.
Set `LEMMA_CURSOR_DATA_DIR` to override it. Files are written atomically, and
POSIX credentials use mode `0600`.

## Development

```bash
pnpm --filter @uselemma/cursor-plugin type-check
pnpm --filter @uselemma/cursor-plugin test
pnpm --filter @uselemma/cursor-plugin build
```

The generated `runtime/` and `scripts/` bundles are not committed. Build
them before setup or a local plugin install (Cursor loads this directory
directly).
