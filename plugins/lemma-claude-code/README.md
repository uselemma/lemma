# Lemma Claude Code plugin

This Claude Code plugin sends one complete Lemma trace when each user prompt
finishes. It uses Claude Code lifecycle hooks directly and does not run an MCP
server.

Each trace contains the user prompt, final assistant response, tool arguments,
tool results, model when Claude exposes it, working directory, and transcript
path. Claude's `session_id` becomes the Lemma `thread_id`, while `prompt_id`
identifies the completed trace within that conversation.

## Local setup

From this repository checkout:

```bash
pnpm --filter @uselemma/claude-code-plugin build
node plugins/lemma-claude-code/scripts/setup.mjs
```

For Lemma's development environment:

```bash
node plugins/lemma-claude-code/scripts/setup.mjs --api-url https://dev.api.uselemma.ai
```

Setup adds this checkout as the `lemma-local` Claude marketplace, installs
`lemma-claude-code@lemma-local` at user scope, opens project selection in the
browser, and stores the resulting project-scoped ingest credential. It never
issues or requests a general Lemma API key.

## Delivery behavior

- `UserPromptSubmit` stages the prompt until Claude exposes its `prompt_id`.
- `PreToolUse` and `PostToolUse` correlate tool context by `tool_use_id`.
- `Stop` closes the prompt with `last_assistant_message` and queues one trace.
- Network delivery runs outside the hook timeout.
- Failed delivery remains on disk and retries on the next prompt or completion.
- Deterministic trace IDs make duplicate delivery safe.

State and credentials use an OS-specific private application-data directory.
Set `LEMMA_CLAUDE_CODE_DATA_DIR` to override it. Files are written atomically,
and POSIX credentials use mode `0600`.

## Development

```bash
pnpm --filter @uselemma/claude-code-plugin type-check
pnpm --filter @uselemma/claude-code-plugin test
pnpm --filter @uselemma/claude-code-plugin build
claude plugin validate plugins/lemma-claude-code --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

The generated runtime and setup bundles are committed because Claude copies the
plugin directory into its installation cache.
