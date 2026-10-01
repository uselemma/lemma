# Lemma SDK — Agent Instructions

## Docs

Agent skills under `.agents/skills/` are Lemma-owned pins, not product skills (`skills/`). `skills-lock.json` records each as `sourceType: local`.

When writing or reviewing `docs/`, follow [`.agents/skills/lemma-writing-guidelines/SKILL.md`](.agents/skills/lemma-writing-guidelines/SKILL.md). Lemma-specific writing rules live only in [`.agents/skills/lemma-writing-guidelines/command.md`](.agents/skills/lemma-writing-guidelines/command.md); do not duplicate them here. That pin is not the upstream `writing-guidelines` skill name, so a later `npx skills add vercel-labs/agent-skills --skill writing-guidelines` installs beside it instead of replacing it. To refresh the handbook, follow the procedure in that skill.

When adding or editing changelog entries, follow [`.agents/skills/lemma-changelog/SKILL.md`](.agents/skills/lemma-changelog/SKILL.md), including its maintenance section when the skill changes.

## Publish protocol

npm and PyPI publish only when a package version field changes on `main`.

When a change should ship to callers, bump every affected package version in the same PR. If the feature PR already merged without a bump, open a follow-up that only bumps versions and merge it immediately.

Version fields:

- `@uselemma/tracing` — `packages/ts/tracing/package.json`
- `uselemma-tracing` — `packages/py/tracing/pyproject.toml` and `uv.lock`
- Harness plugins (`@uselemma/opencode`, `@uselemma/pi`, `@uselemma/hermes`, `@uselemma/openclaw`) — `plugins/lemma-<name>/package.json`
- Skills (`lemma-tracing`, `lemma-diagnostics`, `lemma-mcp`, `lemma-analytics`) — `skills/<name>/SKILL.md` `metadata.version`

A merge that leaves published package versions unchanged does not publish to npm or PyPI. Skill version bumps are for traceability only. Do not land shippable SDK, plugin, or skill changes without a SemVer bump.
