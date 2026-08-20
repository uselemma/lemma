# Verify received-trace quality

Use this after [audit.md](audit.md) confirmed traces exist. Still read-only.

## Crawl live docs

Fetch `https://docs.uselemma.ai/llms.txt`, then the pages listed in
[SKILL.md](../SKILL.md) that match the harness you detected. Always fetch
the trace contract and the high-quality traces guide before scoring.

Do not restate a cached rubric. Quality criteria live on those pages.

## Fetch received traces

Call, in order:

1. `list_dashboard_traces` with `project_id` to pick recent traces
2. `get_trace` with the chosen `trace_id`
3. `list_trace_spans` when the tree is incomplete or children are missing

Keep those tool names verbatim. Never dump the raw payload to the user.
Render each trace as an 8-char id prefix plus a list ordinal.

If MCP is disconnected, say so and stop. Do not invent dashboard results.

## Cross-reference

Score the received tree against the crawled pages, not against memory.

For each finding, cite the docs URL and heading that it comes from. Typical
questions the live docs will answer: one root per execution, stable name,
input plus output or error, typed generations and tools, nesting,
`threadId` / `userId`, timing, multi-turn continuity.

If the traces look healthy against the crawled headings, say so and stop.

## Plan, do not apply

Name the smallest quality change that would satisfy the current docs.
Recommend the matching first-wave adapter from [SKILL.md](../SKILL.md).
Never recommend generic OTLP.

If a code change is required, stop and point at `lemma-tracing`. Do not
edit the app.
