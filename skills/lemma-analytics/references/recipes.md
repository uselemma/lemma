# Recipes

Each recipe maps a common question to a body. Windows use placeholders:
replace `START` and `END` with whole-second UTC timestamps (see
[query.md](query.md)). Check every field against the catalog before sending;
if a project's catalog names a field differently, use the catalog's name.

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

Per agent: replace the bucket with `{ "field": "agent_name", "as": "agent_name" }`
and add `"order_by": [{ "measure": "traces", "direction": "desc" }]`.

One agent: add `"filters": [{ "field": "agent_name", "op": "eq", "value": "NAME" }]`.

## Latency

"How slow is the support agent?" "What's our p95?"

```json
{
  "from": "trace.processed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "agent_name", "as": "agent_name" }],
  "measures": [
    { "as": "traces", "agg": "count" },
    { "as": "p50_ms", "agg": "p50", "field": "duration_ms" },
    { "as": "p95_ms", "agg": "p95", "field": "duration_ms" },
    { "as": "p99_ms", "agg": "p99", "field": "duration_ms" }
  ],
  "order_by": [{ "measure": "p95_ms", "direction": "desc" }]
}
```

`duration_ms` on `trace.processed` is root latency: the whole run. Model call
latency is `duration_ms` on `generation.completed` if the catalog lists it.
Keep the two apart in the answer.

Report percentiles with the `traces` count beside them. A p99 over a few
dozen traces is noise; say so.

## Tool failures

"Which tools fail most?" "Is search_docs flaky?"

```json
{
  "from": "tool.called",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "tool", "as": "tool" }],
  "measures": [
    { "as": "calls", "agg": "count" },
    { "as": "failures", "agg": "sum", "field": "error" }
  ],
  "order_by": [{ "measure": "failures", "direction": "desc" }],
  "limit": 20
}
```

`error` is `1` for a failed tool span and `0` otherwise, so its sum is the
failure count. Compute `failures / calls` yourself and show it as a
percentage. Rank by failures for "most failures", by rate for "least
reliable"; for rate, drop tools with very few calls and say where you cut.

Trend for one tool: filter `tool` with `eq` and group by a day bucket.

Tools one agent uses: filter `agent_name` on `tool.called`, if the catalog
lists it as a dimension of that event.

## Errors over time

"Are errors going up?"

```json
{
  "from": "span.errored",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "bucket": "day", "as": "day" }],
  "measures": [{ "as": "errors", "agg": "count" }]
}
```

An error count rises with traffic. Pair it with the volume recipe over the
same window and report errors per 100 traces, not only the raw count. To
break errors down, group by a dimension the catalog lists on `span.errored`.

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

Rows carry `model`, `estimated_cost_usd`, and `priced`. Sort by
`estimated_cost_usd` yourself. List `priced: false` models separately: Lemma
has no list price for them, so their cost is unknown, not zero, and the total
is a floor.

## Cost by agent

"Which agent costs the most?"

```json
{
  "from": "trace.processed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "agent_name", "as": "agent_name" }],
  "measures": [
    { "as": "traces", "agg": "count" },
    { "as": "cost", "agg": "trace_cost" }
  ]
}
```

Rows carry `estimated_cost_usd`, `cost_lower_bound`, and
`cost_lower_bound_reasons`. Divide cost by `traces` for cost per run. When
`cost_lower_bound` is true, say the figure can be low and give the reasons.

## Tool calls per run

"How many tool calls does each agent make per run?"

```json
{
  "from": "trace.processed",
  "start": "START",
  "end_exclusive": "END",
  "group_by": [{ "field": "agent_name", "as": "agent_name" }],
  "measures": [{ "as": "traces", "agg": "count" }],
  "join": {
    "from": "tool.called",
    "on": "agent_name",
    "measures": [{ "as": "tool_calls", "agg": "count" }]
  }
}
```

Compute `tool_calls / traces`. The same shape works for model calls per run
with `generation.completed` as the joined event.

## Compare two windows

"How does this week compare with last week?"

Run the same body twice with adjacent windows of equal length, such as
`[START - 7d, START)` and `[START, END)`. Report both values and the change as
an absolute and a percent. Don't compare a partial window with a full one;
if "this week" isn't over, compare the same number of days.

## Distinct counts

"How many distinct tools does each agent use?"

Find a measure in the catalog whose `aggs` includes `uniqExact`, then:

```json
{ "as": "distinct_x", "agg": "uniqExact", "field": "FIELD" }
```

If no field allows it, say the distinct count isn't available rather than
grouping and counting rows yourself, unless the result is untruncated.

## Questions analytics can't answer

- "Why did this trace fail?" Use trace tools.
- "Is this issue real?" Use `lemma-mcp`.
- What the user's provider actually billed. Lemma only estimates.
- A field the catalog doesn't list. Say it isn't queryable.
