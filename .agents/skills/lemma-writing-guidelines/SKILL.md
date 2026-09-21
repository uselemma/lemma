---
name: lemma-writing-guidelines
description: Review docs/prose for Writing Guidelines compliance. Use when asked to "review my docs", "check writing style", "audit prose", "review docs voice and tone", or "check this page against the writing handbook".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Writing Guidelines

Review files for compliance with Writing Guidelines.

This skill is a Lemma-owned pin at `.agents/skills/lemma-writing-guidelines/` (project agent skills). It is not a Lemma product skill; do not copy it into `skills/`. Do not install upstream `writing-guidelines` from `vercel-labs/agent-skills` into this folder: that skill name is different on purpose so `npx skills add vercel-labs/agent-skills --skill writing-guidelines` cannot overwrite this pin.

## How It Works

1. Read the pinned rules in [command.md](command.md) in this directory
2. Read the specified files (or prompt user for files/pattern)
3. Apply the whole pin (overlay plus body). There is no skip layer
4. Output findings in the terse `file:line` format

## Guidelines Source

The pinned copy is the source of truth for reviews in this repo:

```
.agents/skills/lemma-writing-guidelines/command.md
```

`skills-lock.json` tracks this folder as a **local** skill so the skills CLI will not fetch GitHub and replace the pin. Optional handbook refresh (manual only):

```
https://raw.githubusercontent.com/vercel-labs/writing-guidelines/main/command.md
```

Refresh procedure: fetch that URL, keep the Lemma overlay, drop Vercel-only sections (pricing, dashboard deep links, ACME, AI Gateway catalog IDs, `vercel/examples`), keep this `SKILL.md`, then refresh `skills-lock.json` `computedHash` with the skills CLI folder hash (`localeCompare` file order). If a CLI reinstall deleted `command.md`, restore it from git.

## Usage

When a user provides a file or pattern argument:
1. Read [command.md](command.md)
2. Read the specified files
3. Apply the whole pin
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
