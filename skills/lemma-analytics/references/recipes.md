# Recipes

Each recipe maps a common question to a body. Replace `START` and `END` with
whole-second UTC timestamps (see [query.md](query.md)). Field meanings are in
[events.md](events.md).

Bodies use REST keys. On MCP, rename `end_exclusive`, `group_by`, and
`order_by` to `endExclusive`, `groupBy`, and `orderBy`.

## Volume

"How many runs did we have?" "Is traffic up?"

```json
{
  "from": "trace.processed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "bucket": "day", "as": "day" }],
  "measures": [{ "as": "traces", "agg": "count" }]
}
```

- Per agent: group by `{ "field": "agent_name" }` and order by `traces` desc.
- One agent: add `"filters": [{ "field": "agent_name", "op": "eq", "value": "NAME" }]`.
- Traces with no agent name have `agent_name: ""`. Label them "unnamed".

## Run latency

"How slow is the support agent?" "What's our p95?"

```json
{
  "from": "trace.processed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "agent_name" }],
  "measures": [
    { "as": "traces", "agg": "count" },
    { "as": "p50_ms", "agg": "p50", "field": "root_duration_ms" },
    { "as": "p95_ms", "agg": "p95", "field": "root_duration_ms" },
    { "as": "p99_ms", "agg": "p99", "field": "root_duration_ms" }
  ],
  "order_by": [{ "measure": "p95_ms", "direction": "desc" }]
}
```

`root_duration_ms` is the whole run. Report percentiles with the trace count
beside them; a p99 over a few dozen traces is noise.

## Model latency and throughput

"Which model is slowest?" "What's our tokens per second?"

```json
{
  "from": "generation.completed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "model" }],
  "measures": [
    { "as": "calls", "agg": "count" },
    { "as": "p95_ms", "agg": "p95", "field": "duration_ms" },
    { "as": "avg_tps", "agg": "avg", "field": "tps" },
    { "as": "failures", "agg": "count", "filter": { "field": "error", "op": "eq", "value": 1 } }
  ],
  "order_by": [{ "measure": "calls", "direction": "desc" }]
}
```

Keep model call latency apart from run latency in the answer.

## Tool failures

"Which tools fail most?" "Is search_docs flaky?"

```json
{
  "from": "tool.called",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "tool" }],
  "measures": [
    { "as": "calls", "agg": "count" },
    { "as": "failures", "agg": "sum", "field": "error" },
    { "as": "p95_ms", "agg": "p95", "field": "duration_ms" }
  ],
  "order_by": [{ "measure": "failures", "direction": "desc" }],
  "limit": 20
}
```

`error` is `1` per failed call, so its sum is the failure count. Compute
`failures / calls` as a percent. Rank by failures for "fails most", by rate
for "least reliable"; for rate, drop tools with very few calls and say where
you cut.

- One tool over time: filter `tool` with `eq`, group by a day bucket.
- One agent's tools: filter `agent_name` on `tool.called`.

## Failed runs by agent

"Which agent errors most?"

```json
{
  "from": "trace.processed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "agent_name" }],
  "measures": [
    { "as": "traces", "agg": "count" },
    { "as": "runs_with_errors", "agg": "count", "filter": { "field": "error_count", "op": "gt", "value": 0 } },
    { "as": "failing_tool_calls", "agg": "sum", "field": "failing_tool_calls" }
  ],
  "order_by": [{ "measure": "runs_with_errors", "direction": "desc" }]
}
```

`error_count > 0` means some span in the run failed, not that the run
failed. For runs whose root failed, group by `root_status_code` first to see
the values this project records, then filter on the error value.

## Errors over time

"Are errors going up?" "Which spans fail?"

```json
{
  "from": "span.errored",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "bucket": "day", "as": "day" }],
  "measures": [{ "as": "errors", "agg": "count" }]
}
```

Group by `{ "field": "span_name" }` instead to see which spans fail. Errors
rise with traffic, so pair this with the volume recipe over the same window
and report errors per 100 traces.

## Cost by model

"What are we spending on models?"

```json
{
  "from": "generation.completed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "model", "as": "model" }],
  "measures": [{ "as": "cost", "agg": "generation_cost" }]
}
```

Rows carry `model`, `estimated_cost_usd`, and `priced`; sort by
`estimated_cost_usd` yourself. List `priced: false` models separately: their
cost is unknown, not zero, so the total is a floor. Add
`{ "as": "input_tokens", "agg": "sum", "field": "input_tokens" }` and the
output equivalent if the user wants tokens beside cost.

## Cost by agent

"Which agent costs the most?"

```json
{
  "from": "trace.processed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "agent_name" }],
  "measures": [
    { "as": "traces", "agg": "count" },
    { "as": "tokens", "agg": "sum", "field": "total_tokens" },
    { "as": "cost", "agg": "trace_cost" }
  ]
}
```

Divide `estimated_cost_usd` by `traces` for cost per run. When
`cost_lower_bound` is true, say the figure can be low and give the reasons.
There's no model-by-agent split: `generation.completed` has no `agent_name`.

## Tool use per agent

"How many tool calls does each agent make per run?" "How many distinct tools
does each agent use?"

```json
{
  "from": "trace.processed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "agent_name" }],
  "measures": [{ "as": "traces", "agg": "count" }],
  "join": {
    "from": "tool.called",
    "on": "agent_name",
    "measures": [
      { "as": "tool_calls", "agg": "count" },
      { "as": "tools_used", "agg": "uniqExact", "field": "tool" }
    ]
  }
}
```

Compute `tool_calls / traces` per agent. An agent with no tool calls has null
joined measures; show 0 calls. For tool failures per agent, add
`"filters": [{ "field": "error", "op": "eq", "value": 1 }]` inside `join`.

## Issue activity

"How many issues did Lemma open each week?"

```json
{
  "from": "issue.created",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "bucket": "week", "as": "week" }],
  "measures": [{ "as": "issues", "agg": "count" }]
}
```

Swap in `issue.resolved` or `issue.dismissed` for those counts. For what the
issues are, use `lemma-mcp`.

## Compare two windows

"How does this week compare with last week?"

Run the same body twice with adjacent windows of equal length, such as
`[START - 7d, START)` and `[START, END)`. Report both values and the change
as an absolute and a percent. Don't compare a partial window with a full
one; if "this week" isn't over, compare the same number of days.

## Questions analytics can't answer

- Model use or cost by agent. `generation.completed` has no `agent_name`.
- "Why did this trace fail?" Use trace tools.
- "Is this issue real?" Use `lemma-mcp`.
- What the provider actually billed. Lemma only estimates.
- Anything older than 90 days.
- A field the catalog doesn't list. Say it isn't queryable.
