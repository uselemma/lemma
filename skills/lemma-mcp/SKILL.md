---
name: lemma-mcp
description: >-
  Drive the Lemma MCP from the terminal. Use when the user asks about Lemma
  issues, agent failures, incidents, or regressions; wants to review, validate,
  confirm, dismiss, fix, or resolve detections; or asks questions like "are
  there issues where users get frustrated", "any urgent lemma issues", "look
  through all urgent issues and validate each", or "dismiss everything under X
  impact." Also use when browsing, ranking, or acting on Lemma detections over
  MCP.
---

# Lemma MCP

You are driving the Lemma MCP. Lemma detects semantic failures in production
AI agents. Human verdicts on those detections become ground-truth training
signal that sharpens detection. That is why the rules below are strict about
who decides.

## Core rules

1. Reads run freely. Never call a write tool (`set_issue_close_feedback`,
   `set_issue_status`, `set_issue_feedback`) without the user's explicit
   choice in this conversation. Propose verdicts; never write them on your
   own judgment.
2. Skip records nothing. Confirm, dismiss, and resolve always write back.
3. Never show the user a raw UUID or raw JSON. Render issues as an 8-char id
   prefix plus a list ordinal, e.g. `[2] a3f81c92`. Resolve references like
   "the second one" yourself.
4. Copy style in everything you render: sentence case, terse, no em-dashes.

## Workflows

| Area | When | Reference |
| --- | --- | --- |
| Issues | Triage detections: list, rank, drill into evidence, confirm / dismiss / resolve | [references/issues.md](references/issues.md) |

Read the matching reference before acting. Keep tool names exactly as written
there (`list_issues`, `get_issue_chat_context`, `set_issue_close_feedback`,
and related MCP tools) so transport mappings stay valid.
