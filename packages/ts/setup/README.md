# @uselemma/setup

Connects an app and its coding agent to [Lemma](https://uselemma.ai) through one browser approval. The approval picks or creates the Lemma project; the command writes a project-limited ingest key to the app's `.env` and an organization admin key to the coding agent's MCP config.

Coding agents run it when they follow the [`lemma-setup` skill](https://github.com/uselemma/lemma/blob/main/skills/lemma-setup/SKILL.md) from the setup prompt in Lemma. `start` begins the approval and returns; `wait` checks for it for up to 90 seconds and exits with 5 while it is still pending:

```bash
npx --yes @uselemma/setup@0.1.0 start \
  --harness claude-code \
  --project-name "Support bot" \
  --agent-name support-bot
npx --yes @uselemma/setup@0.1.0 wait
```

Flags, the files written for each coding agent, key reuse, and exit codes: [Setup command and skill](https://docs.uselemma.ai/reference/setup-command).

## Development

```bash
pnpm --filter @uselemma/setup type-check
pnpm --filter @uselemma/setup test
pnpm --filter @uselemma/setup build
```

Tests run against a local mock of the Lemma API. Pass `--api-url` with a `localhost` URL to run a build against a local Lemma API.
