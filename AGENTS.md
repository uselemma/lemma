# Lemma SDK — Agent Instructions

## Docs

When writing or reviewing `docs/`, follow [`.agents/skills/writing-guidelines/SKILL.md`](.agents/skills/writing-guidelines/SKILL.md). Lemma-specific writing rules live only in the overlay at the top of [`.agents/skills/writing-guidelines/command.md`](.agents/skills/writing-guidelines/command.md); do not duplicate them here.

That directory is the only local copy of this skill; do not put it under `skills/` (that tree is Lemma product skills). `skills-lock.json` `skillPath` is the path in `vercel-labs/agent-skills`; `computedHash` is the SHA-256 of this local skill folder.

## Publish protocol

npm and PyPI publish only when a package version field changes on `main`.

When a change should ship to callers, bump every affected package version in the same PR. If the feature PR already merged without a bump, open a follow-up that only bumps versions and merge it immediately.

Version fields:

- `@uselemma/tracing` — `packages/ts/tracing/package.json`
- `uselemma-tracing` — `packages/py/tracing/pyproject.toml` and `uv.lock`
- Harness plugins (`@uselemma/opencode`, `@uselemma/pi`, `@uselemma/hermes`, `@uselemma/openclaw`) — `plugins/lemma-<name>/package.json`
- Skills (`lemma-tracing`, `lemma-diagnostics`, `lemma-mcp`) — `skills/<name>/SKILL.md` `metadata.version`

A merge that leaves published package versions unchanged does not publish to npm or PyPI. Skill version bumps are for traceability only. Do not land shippable SDK, plugin, or skill changes without a SemVer bump.
