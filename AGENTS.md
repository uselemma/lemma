# Lemma SDK — Agent Instructions

## Docs

When writing or reviewing `docs/`, follow [`.agents/skills/writing-guidelines/SKILL.md`](.agents/skills/writing-guidelines/SKILL.md). Read the pinned rules in [`.agents/skills/writing-guidelines/command.md`](.agents/skills/writing-guidelines/command.md). That directory is the only local copy of this skill; do not put it under `skills/` (that tree is Lemma product skills). `skills-lock.json` `skillPath` is the path in `vercel-labs/agent-skills`; `computedHash` is the SHA-256 of this local skill folder.

Lemma-specific adaptations:

- Mintlify frontmatter uses `title` (H1), `sidebarTitle` (nav label), and `meta.contentType` (`Tutorial`, `How-to`, `Reference`, `Conceptual`, `Troubleshooting`, or `Landing`)
- Every page’s content plan lives on the page: `meta.goal` (verb-driven outcome) and `meta.audience`. `description` is the nav/SEO blurb and must not copy `goal` verbatim
- Curly quotes in Markdown prose (`“ ”`, `’`). Keep straight quotes as YAML, JSX, and code delimiters, inside fenced/inline code, and in JSX/HTML text that is demo data
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
