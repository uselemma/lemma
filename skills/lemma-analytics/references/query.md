# Building analytics queries

## 1. Read the catalog

MCP: `describe_project_analytics` with `project_id`.

REST:

```bash
curl -s "https://api.uselemma.ai/projects/$LEMMA_PROJECT_ID/analytics/catalog" \
  -H "Authorization: Bearer $LEMMA_API_KEY"
```

The response has four keys. Keep it in context for the rest of the
conversation; it doesn't change between queries.

| Key | Shape | Use it for |
| --- | --- | --- |
| `events` | `[{ name, dimensions, measures, cost_measures }]` | What `from` can be, and which fields each event has |
| `filter_ops` | `string[]` | Valid `op` values in `filters` |
| `buckets` | `string[]` | Valid time buckets in `group_by` |
| `limits` | `{ max_group_by, max_measures, max_filters, max_order_by, max_in_values, max_rows, max_window_days }` | Hard caps; a query over any of them fails with HTTP 400 |

Per event:

- `dimensions`: `[{ field, type }]`. Fields you can filter and group by.
- `measures`: `[{ field, type, aggs }]`. Fields you can aggregate, and the
  aggregations each one allows. An aggregation not in `aggs` for that field
  is rejected.
- `cost_measures`: `string[]`, such as `trace_cost` or `generation_cost`.
  Empty when the event has no cost.

Events you will usually see include `trace.processed` (one row per trace),
`generation.completed` (one per model call), `tool.called` (one per tool
span), `span.errored` (one per failed span), and issue lifecycle events. The
catalog is the source of truth; use the names it returns.

To find the right event, map the user's noun to the row: "runs" or "traces"
is `trace.processed`, "model calls" or "tokens" is `generation.completed`,
"tool calls" is `tool.called`, "errors" is `span.errored` or the `error`
measure on the event that owns it.

## 2. Build the body

| Key | Required | Notes |
| --- | --- | --- |
| `from` | Yes | Event name from the catalog |
| `start` | Yes | ISO-8601 UTC, whole second, inclusive |
| `end_exclusive` | Yes | ISO-8601 UTC, whole second, exclusive |
| `measures` | Yes | At least one |
| `filters` | No | All must match |
| `group_by` | No | Time bucket or dimension |
| `order_by` | No | By measure or group alias |
| `limit` | No | Defaults to `limits.max_rows` |
| `join` | No | One other event |

### Window

- Both ends must be whole seconds in UTC. `2026-09-23T00:00:00.000Z` works;
  `2026-09-23T00:00:00.500Z` doesn't.
- The end is exclusive. For "September 23 through 29", send
  `start: 2026-09-23T00:00:00.000Z`, `end_exclusive: 2026-09-30T00:00:00.000Z`.
- The span can't exceed `limits.max_window_days`.
- "Today" or "so far" windows end at the current time truncated to the
  second. Say the last bucket is partial.

Compute windows with a tool, not by hand:

```bash
date -u -d '7 days ago 00:00' +%Y-%m-%dT%H:%M:%S.000Z   # start, GNU date
date -u -d 'today 00:00' +%Y-%m-%dT%H:%M:%S.000Z        # end_exclusive
```

On macOS, use `date -u -v-7d -v0H -v0M -v0S +%Y-%m-%dT%H:%M:%S.000Z`.

### Measures

```json
{ "as": "alias", "agg": "aggregation", "field": "field" }
```

- `count` counts rows. Omit `field`.
- `sum`, `avg`, `min`, `max`, `p50`, `p95`, `p99` need a numeric `field`
  whose catalog `aggs` lists that aggregation.
- `uniqExact` counts distinct values of a field whose `aggs` lists it.
- A cost measure uses the cost name as `agg` and omits `field`. One cost
  measure per query, on the primary event only.
- `generation_cost` also needs `group_by` on `model` with alias `model`.
- Aliases start with a letter, then lowercase letters, digits, and
  underscores, at most 41 characters. Aliases must be unique across
  measures and groups.

Cost rows don't use your alias. `generation_cost` rows carry
`estimated_cost_usd` and `priced`. `trace_cost` rows carry
`estimated_cost_usd`, `cost_lower_bound`, and `cost_lower_bound_reasons`.

### Filters

```json
{ "field": "agent_name", "op": "eq", "value": "support_agent" }
```

- `op` must be in the catalog `filter_ops`.
- A comparison operator such as `eq` takes one scalar `value`.
- `in` takes an array of at most `limits.max_in_values` values.
- `is_null` and `is_not_null` omit `value`.
- Filter values are exact. If the user names an agent loosely ("the support
  bot"), first group by `agent_name` over the window to list the real names,
  then filter on the match. Confirm with the user when more than one name
  fits.

### Group and order

```json
"group_by": [
  { "bucket": "day", "as": "day" },
  { "field": "agent_name", "as": "agent_name" }
],
"order_by": [{ "measure": "traces", "direction": "desc" }]
```

- A bucket must be in the catalog `buckets`. A day bucket comes back as a
  date string such as `2026-09-23`.
- A field group must be a dimension of the event.
- `order_by.measure` names any measure alias or group alias. `direction` is
  `asc` or `desc`. Without `order_by`, grouped rows are sorted by the group.
- For a "top N", set `order_by` desc and `limit: N`.
- Don't assume every bucket comes back. If a day is missing from the rows,
  treat it as no data, not as zero, unless the measure is a count. Say so
  when you fill gaps in a series.

### Join

```json
"join": {
  "from": "tool.called",
  "on": "agent_name",
  "measures": [{ "as": "tool_calls", "agg": "count" }]
}
```

- One join per query, on a field that is a dimension of both events.
- Group the primary query by the `on` field, so each row pairs both counts
  for one value.
- Joined measure aliases must not collide with primary aliases.
- Cost measures stay on the primary event.

## 3. Send it

MCP: `query_project_analytics` with `project_id` plus the body, with three
keys in camelCase: `endExclusive`, `groupBy`, `orderBy`. Everything else,
including field names such as `agent_name`, stays as written.

REST:

```bash
curl -s -X POST \
  "https://api.uselemma.ai/projects/$LEMMA_PROJECT_ID/analytics/query" \
  -H "Authorization: Bearer $LEMMA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @query.json
```

Run independent queries in parallel. A comparison of two windows is two
queries.

## 4. Read the response

```json
{
  "rows": [{ "day": "2026-09-23", "traces": 120, "p95_ms": 840.5 }],
  "truncated": false,
  "window": { "start": "...", "end_exclusive": "..." }
}
```

- `rows`: one object per group, keyed by your aliases (cost fields
  excepted, see above). With no `group_by`, one row.
- `truncated`: true when the rows hit `limit` or `limits.max_rows`. More
  groups exist. Narrow filters, use a coarser bucket, or raise `limit` up to
  `max_rows`. Never present a truncated ranking as complete.
- `window`: the window that ran. Quote it in the answer.

Both transports return this snake_case shape.

## 5. Recover from errors

| Response | Cause | Fix |
| --- | --- | --- |
| 400 | Invalid body. `detail` says which part | Read `detail`, recheck against the catalog, fix that part only, retry once |
| Auth error | Missing, wrong, or ingest-only key | Ask for an organization key with read or admin scope |
| 404 | Unknown project, or a key limited to another project | Confirm the project id with the user |
| Fails after 15s | Query too expensive | Shorten the window, drop a group, or use a coarser bucket |
| 503 | Lemma unavailable | Retry once after a short wait, then tell the user |

Common 400 causes: a field not in the event, an aggregation not in that
field's `aggs`, a window not on a whole second, a window longer than
`max_window_days`, a duplicate alias, `field` set on `count` or a cost
measure, `generation_cost` without a `model` group, or a list over a limit.

## 6. Windows longer than the limit

Split the range into adjacent windows within `max_window_days`, run one query
per window, then combine:

- `count`, `sum`: add across windows.
- `min`, `max`: take the min or max of the parts.
- `avg`: weight each part by its `count`. Add a `count` measure to every
  part so you can.
- `p50`, `p95`, `p99`, `uniqExact`: can't be combined. Report per window, or
  tell the user the overall figure isn't available over that range.
- Estimated cost: add `estimated_cost_usd`; carry over any `priced: false` or
  `cost_lower_bound: true`.
