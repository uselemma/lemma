# Lemma for OpenCode

`@uselemma/opencode` records one complete Lemma trace for each OpenCode user turn. It uses OpenCode's native plugin hooks and event stream directly. It does not install an MCP server or require an npm-published plugin for local use.

## Install

```bash
pnpm dlx @uselemma/opencode setup
```

The setup command installs the bundled plugin into
`~/.config/opencode/plugins/uselemma-opencode.js`, opens project-scoped Lemma
authorization, and stores the returned credential under
`~/.config/opencode/lemma`.

## Local development

From a Lemma checkout:

```bash
pnpm install
pnpm --filter @uselemma/tracing build
pnpm --filter @uselemma/opencode build
node plugins/lemma-opencode/scripts/setup.mjs
```

OpenCode automatically loads global plugin files at startup.

For development:

```bash
node plugins/lemma-opencode/scripts/setup.mjs \
  --api-url https://dev.api.uselemma.ai
```

Use `--config-dir PATH` and `--data-dir PATH` for isolated verification. Use `--skip-install` to rotate credentials without replacing the installed plugin files.

## Captured data

- User prompt and final assistant response.
- OpenCode session and message IDs.
- Model provider, model ID, and agent name.
- Native tool inputs, outputs, errors, and timing.
- One Lemma thread per OpenCode session.

Sensitive keys, authorization values, common provider tokens, credential-bearing URLs, and PEM material are removed before a turn is queued. Failed deliveries remain in a private pending directory and retry on the next plugin startup or completed turn. A turn keeps the API and project scope active when capture started. Rotating credentials for the same project preserves delivery, while switching projects leaves the older trace queued instead of misrouting it.

## Verification

```bash
pnpm --filter @uselemma/opencode type-check
pnpm --filter @uselemma/opencode test
pnpm --filter @uselemma/opencode build
pnpm --filter @uselemma/opencode verify:local
```
