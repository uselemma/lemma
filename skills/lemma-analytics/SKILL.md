---
name: lemma-analytics
description: >-
  Answer questions about a Lemma project's production numbers with the
  analytics API, over the Lemma MCP or REST. Use when the user asks how many
  traces an agent ran, how latency or error rates are trending, which tools
  fail most, what a model or agent costs, how this week compares with last
  week, or wants a breakdown by agent, model, tool, or day. Also use when
  writing a script or report that calls describe_project_analytics,
  query_project_analytics, get_project_analytics, or the
  /projects/{project_id}/analytics routes. Do not use for triaging detected
  issues (that is lemma-mcp) or for fixing missing telemetry (that is
  lemma-tracing and lemma-diagnostics).
metadata:
  version: 1.0.0
---

# Lemma Analytics

You are answering questions with numbers from a Lemma project. Lemma stores
analytics events from ingested traces and computes aggregates on request. You
pick the event, window, and measures; Lemma returns rows. Every number you
report comes from a call you made in this conversation.

## Core rules

1. Read the catalog before the first query for a project in this
   conversation. Never guess an event, field, aggregation, filter operator,
   or bucket. If the catalog lacks it, say so; don't approximate with a
   different field.
2. Every call here is a read. Run them without asking. Never print the API
   key, and never write it to a file the user didn't ask for.
3. Always set an explicit window and state it in the answer, in UTC, with the
   end exclusive. When the user gives no window, use the last 7 full UTC days
   and say so.
4. Cost is an estimate from token counts and public list prices, never an
   invoice. Say "estimated" every time, and surface `priced: false` and
   `cost_lower_bound: true` rather than hiding them.
5. Report what came back, not what you expected. If `truncated` is true, say
   the result is partial. If rows are empty, say so and offer the likely
   cause; don't fill gaps with zeros.
6. Never show raw JSON unless the user asks for it. Render a table or a
   sentence, sentence case, terse, no em-dashes.

## Choose the call

| Need | Call | Reference |
| --- | --- | --- |
| Events, fields, aggregations, limits for this project | `describe_project_analytics` | [references/query.md](references/query.md) |
| One number or one breakdown | `query_project_analytics` | [references/query.md](references/query.md) |
| A question that matches a common pattern | `query_project_analytics` | [references/recipes.md](references/recipes.md) |
| A whole dashboard panel (scorecards, tool aggregates, ROI) | `get_project_analytics` | [references/presets.md](references/presets.md) |
| Turning rows into an answer | | [references/reporting.md](references/reporting.md) |

Read the matching reference before acting. Keep operation names exactly as
written; MCP tools and REST operations share them.

## Transport

Use the Lemma MCP when it is connected: call the tool with `project_id` plus
the body. Otherwise use REST against `https://api.uselemma.ai` with
`Authorization: Bearer $LEMMA_API_KEY`. The key must be an organization API
key with read or admin scope; an ingest-only key can't call these routes.

If you have neither an MCP connection nor a key, stop and ask the user for
one. Point them to **API Keys** in the
[Lemma dashboard](https://platform.uselemma.ai) and the
[MCP setup page](https://docs.uselemma.ai/connections/mcp).

If you don't know the project id, ask. With the MCP connected, you can list
projects first if a project listing tool is available.

## Scope

- Issue triage, verdicts, and evidence: `lemma-mcp`.
- A metric that is empty or "not instrumented" because the SDK doesn't emit
  the field: explain the gap from [references/reporting.md](references/reporting.md),
  then offer `lemma-diagnostics` to audit and `lemma-tracing` to fix.
- Single-trace debugging: use trace tools, not analytics.
