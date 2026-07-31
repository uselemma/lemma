# Triaging Lemma issues

## Listing issues

Call `list_issues` with `project_id`, `status: "open"`, and `limit`/`offset`.
Always pass `status` explicitly; the MCP path applies no default.

Rank the results yourself (there is no server-side urgency sort):
`notify` true first, then `fired_count` desc, then the sum of
`lane_scores.A + B + C` desc, then `last_seen_at` desc. Treat `notify: null`
as not notifiable.

Show only notifiable issues (`notify === true`) unless the user asks for
more. Render as a compact table:

| # | id | issue | impact | spike | persist | occurs | traffic |
|---|-----|------|--------|-------|---------|--------|---------|

- issue = `name` (append `failure_class` in parens when it disambiguates)
- impact / spike / persist = `lane_scores.A` / `.B` / `.C`
- occurs = `occurrence_count`
- traffic = `raw_lane_scores.impact_trace_share × 100`, rendered `~X%`

End every list, including filtered ones, with a bold footer:
**N notifiable issues / M open related issues**
(N = notifiable shown, M = open non-notifiable matches). Never render the
open ones unless asked; the footer is how the user knows they exist.

If `has_more` is true, say so with the total. Fetch further pages only when
the task needs the full set; stop after ~5 pages and suggest filtering. For
counts or group-bys, page with a small field set and tally; state that the
tally covers what was fetched if you hit the page cap.

## Filtered questions

"Any issues where users get frustrated?" There is no server-side semantic
search over issues. Fetch the open list, match against `name`,
`failure_class`, `subsystem`, and, where needed, occurrence titles and
rationales (via `get_issue_chat_context` on candidates). Return matching
notifiable issues in the same table + footer. Offer the open matches, do not
show them.

## Issue detail

Call `get_issue_chat_context` with `issue_id` and `project_id`. One call
returns the issue, its occurrences, span-level trace bundles, and a `stats`
block. Render:

- name, agent_name, failure_class / subsystem
- impact / spike / persistence from `lane_scores`, ~traffic %
- first seen / last seen and occurrence count from `stats`
- Lemma's own validation read (`validation.status`, `.confidence`,
  `.evidenceSummary`; note this sub-object is camelCase) — treat it as
  input to your assessment, not as the verdict
- each occurrence: `title`, `rationale`, and its citations

Citations are span references: `{span_id, quote, char_start, char_end,
rationale?}` (char `-1` means the quote was not located). For each cited
span, render the exchange as an input → output pair pulled from the span's
`attributes`/`events`. If there is no clean input/output (tool-call-only
spans, background steps), write a 1–2 line summary of what the span shows
yourself, grounded in the quote. Never dump raw spans.

Close the detail with your proposed verdict, grounded in the occurrences,
and the three options: confirm, dismiss, skip. Then stop and wait.

## Trace drill-down

When asked to see a trace or citation in more detail, use the span bundles
already in `get_issue_chat_context` (fall back to `get_trace` /
`list_trace_spans` for spans outside the bundle). Always present the trace
inside its occurrence and citation frame: the occurrence's claim, the cited
quote, then the surrounding exchange. Never a standalone trace dump.

## Acting on an issue

All three writes go through `set_issue_close_feedback` with `issue_id`,
`project_id`, and:

- **confirm** (user judges the issue real): `action: "confirmed"`. Ask
  whether they want a fix drafted (see below).
- **dismiss**: first ask once, in substance: "Want to explain why? This
  informs Lemma's detection and sharpens it through Artifacts." If they
  answer, map their reason to `category` using exactly one of: `False
  positive`, `Working as intended`, `Test or synthetic traffic` — and put
  their words in `reason_text`. If they decline, send `action: "dismissed"`
  bare. Ask once, never twice.
- **resolve** (fix shipped or issue addressed): `action: "resolved"`, with
  `reason_text` noting the fix (PR link if one exists).

Skip: acknowledge and move on. No write, no suppression; it resurfaces next
walk.

After any action, including skip, offer the next issue in the ranked list.
Never auto-advance.

## Drafting a fix

When the user wants a fix after confirming: "Pulling from the Lemma MCP.
Want to follow the skill and make a new worktree for this fix, plus a PR
when done?" On yes: create a worktree, make the smallest single-concern
change that addresses the failure mechanism shown in the occurrences, open
a PR whose description links the issue id and cites the evidence
(occurrence titles + quoted citations). Then offer resolve.

## Direct requests (no browsing intended)

"Validate these for me", "dismiss all issues with less than X impact":
do not render the list or details. Read each matching issue's evidence
yourself (`get_issue_chat_context`), then present one confirmation table:

- judgment batches: `# · id · proposed action · one-line rationale`
- objective-criterion batches: the ids + the criterion, terse

One confirmation for the whole table, per-row overrides allowed. Execute
writes only after the user confirms. Skipping the render never means
skipping the evidence or the confirmation.

## Batch walks

"Go through all urgent issues": same as above — walk every notifiable
issue, build the judgment table, single confirmation, then write-backs,
then a summary of what was recorded.
