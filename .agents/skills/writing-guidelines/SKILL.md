---
name: writing-guidelines
description: Review docs/prose for Writing Guidelines compliance. Use when asked to "review my docs", "check writing style", "audit prose", "review docs voice and tone", or "check this page against the writing handbook".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Writing Guidelines

Review files for compliance with Writing Guidelines.

This skill is installed at `.agents/skills/writing-guidelines/` (project agent skills). It is not a Lemma product skill; do not copy it into `skills/`.

## How It Works

1. Read the pinned rules in [command.md](command.md) in this directory
2. Read the specified files (or prompt user for files/pattern)
3. Apply the **Lemma overlay** at the top of `command.md` first. Skip body rules that overlay explicitly overrides. Then apply the remaining body rules
4. Output findings in the terse `file:line` format

## Guidelines Source

The pinned copy is the source of truth for reviews in this repo:

```
.agents/skills/writing-guidelines/command.md
```

Optional refresh (do not treat as required for a review):

```
https://raw.githubusercontent.com/vercel-labs/writing-guidelines/main/command.md
```

If you fetch the URL and it differs from the pin, merge the Lemma overlay at the top of `command.md` before updating the pin, then refresh `skills-lock.json` `computedHash` with the skills CLI folder hash.

## Usage

When a user provides a file or pattern argument:
1. Read [command.md](command.md)
2. Read the specified files
3. Apply the Lemma overlay first; skip body rules it overrides; then apply the rest
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
