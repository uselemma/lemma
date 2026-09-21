# Lemma SDK — Agent Instructions

## Docs

When writing or reviewing `docs/`, follow [`.agents/skills/writing-guidelines/SKILL.md`](.agents/skills/writing-guidelines/SKILL.md). Fetch the latest rules from that skill's guidelines source before each review.

Lemma-specific adaptations:

- Mintlify frontmatter uses `title` (H1), `sidebarTitle` (nav label), and `meta.contentType` (`Tutorial`, `How-to`, `Reference`, `Conceptual`, `Troubleshooting`, or `Landing`)
- Every page’s content plan lives on the page: `meta.goal` (verb-driven) and `meta.audience`. Fill both when you add or rewrite a page
- Curly quotes in prose (`“ ”`, `’`). Keep straight quotes as YAML, JSX, and code delimiters, and inside fenced/inline code
- Example model strings should match the integration’s provider, not Vercel AI Gateway catalog IDs

## Publish protocol

npm and PyPI publish only when a package version field changes on `main`.

When a change should ship to callers, bump every affected package version in the same PR. If the feature PR already merged without a bump, open a follow-up that only bumps versions and merge it immediately.

Version fields:

- `@uselemma/tracing` — `packages/ts/tracing/package.json`
- `uselemma-tracing` — `packages/py/tracing/pyproject.toml` and `uv.lock`
- Harness plugins (`@uselemma/opencode`, `@uselemma/pi`, `@uselemma/hermes`, `@uselemma/openclaw`) — `plugins/lemma-<name>/package.json`
- Skills (`lemma-tracing`, `lemma-diagnostics`, `lemma-mcp`) — `skills/<name>/SKILL.md` `metadata.version`

A merge that leaves published package versions unchanged does not publish to npm or PyPI. Skill version bumps are for traceability only. Do not land shippable SDK, plugin, or skill changes without a SemVer bump.
