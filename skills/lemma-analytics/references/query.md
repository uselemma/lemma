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

| Key | Use it for |
| --- | --- |
| `events` | What `from` can be, and each event's `dimensions`, `measures`, and `cost_measures` |
| `filter_ops` | Valid `op` values in a filter |
| `buckets` | Valid time buckets in `group_by` |
| `limits` | Caps on group-bys, measures, filters, order-bys, `in` values, rows, and window days |

Map the user's question to an event and fields with
[events.md](events.md).

## 2. Build the body

| Key | Required | Notes |
| --- | --- | --- |
| `from` | Yes | Event name |
| `start` | Yes | ISO-8601 UTC, whole second, inclusive |
| `end_exclusive` | Yes | ISO-8601 UTC, whole second, exclusive, after `start` |
| `measures` | Yes | 1 to `limits.max_measures` |
| `filters` | No | Up to `limits.max_filters`; all must match |
| `group_by` | No | Up to `limits.max_group_by` |
| `order_by` | No | Up to `limits.max_order_by` |
| `limit` | No | 1 to `limits.max_rows`; defaults to `max_rows` |
| `join` | No | One other event |

Unknown keys are rejected.

### Window

- Both ends must be whole seconds. `2026-09-23T00:00:00.000Z` works;
  `2026-09-23T00:00:00.500Z` doesn't.
- The end is exclusive and must be after the start. For "September 23
  through 29", send `start: 2026-09-23T00:00:00.000Z` and
  `end_exclusive: 2026-09-30T00:00:00.000Z`.
- The span can't exceed `limits.max_window_days` (90).
- A window ending "now" ends at the current time truncated to the second.
  Say the last bucket is partial.

Compute windows with a tool, not by hand:

```bash
date -u -d '7 days ago 00:00' +%Y-%m-%dT%H:%M:%S.000Z   # start, GNU date
date -u -d 'today 00:00' +%Y-%m-%dT%H:%M:%S.000Z        # end_exclusive
```

On macOS, use `date -u -v-7d -v0H -v0M -v0S +%Y-%m-%dT%H:%M:%S.000Z`.

### Measures

```json
{ "as": "alias", "agg": "aggregation", "field": "field", "filter": { ... } }
```

- `count` counts rows. It takes no `field`.
- `uniqExact` counts distinct values of any field, string or numeric.
- `sum`, `avg`, `min`, `max`, `p50`, `p95`, `p99` need a numeric field whose
  catalog `aggs` lists that aggregation.
- `filter` is optional and takes one filter object. The measure then counts
  or aggregates only matching rows, while other measures see every row. Use
  it for a rate in one query:

```json
"measures": [
  { "as": "calls", "agg": "count" },
  { "as": "failures", "agg": "count", "filter": { "field": "error", "op": "eq", "value": 1 } }
]
```

- Cost measures (`trace_cost` on `trace.processed`, `generation_cost` on
  `generation.completed`) use the cost name as `agg` and take no `field` or
  `filter`. One cost measure per query, on the primary event only.
- `generation_cost` also needs a group on `model` whose alias is `model`.

Aliases match `^[a-z][a-z0-9_]{0,40}$`: a lowercase letter, then up to 40
lowercase letters, digits, or underscores. They must be unique across groups
and measures.

### Filters

```json
{ "field": "agent_name", "op": "eq", "value": "support_agent" }
```

- `eq`, `neq`, `gt`, `gte`, `lt`, `lte` take one string or number.
- `in` takes a non-empty array of up to `limits.max_in_values` (20) values.
- `is_null` and `is_not_null` take no `value`.
- Values are exact. Missing strings are stored as `''`, so "agent unset" is
  `{ "field": "agent_name", "op": "eq", "value": "" }`, not `is_null`.
- If the user names something loosely ("the support bot"), first group by
  that field over the window to list real values, then filter on the match.
  Confirm with the user when more than one fits.

### Group and order

```json
"group_by": [
  { "bucket": "day", "as": "day" },
  { "field": "agent_name" }
],
"order_by": [{ "measure": "traces", "direction": "desc" }]
```

- Buckets: `minute`, `hour`, `day`, `week`, `month` (check `buckets`). A
  `day` bucket returns `2026-09-23`; `hour` and `minute` return
  `2026-09-23 14:00:00`. Weeks start on Sunday. Months start on the 1st.
- `as` is optional. A bucket's alias defaults to `bucket`; a field's to the
  field name. Set `as` on buckets so rows read clearly.
- `order_by.measure` names a group alias or a primary measure alias, not a
  joined measure. `direction` is `asc` or `desc`.
- Without `order_by`, grouped rows come back sorted by the groups.
- For a top N, order desc and set `limit: N`.
- Groups with no rows are absent. Treat a missing bucket as zero only for
  `count` and `sum`, and say so when you fill gaps.

### Join

```json
"join": {
  "from": "tool.called",
  "on": "agent_name",
  "filters": [{ "field": "error", "op": "eq", "value": 1 }],
  "measures": [{ "as": "tool_failures", "agg": "count" }]
}
```

- One join, to a different event, on a field both events have (see
  [events.md](events.md)). The joined side is grouped by `on` and LEFT
  JOINed, so primary rows without a match get null joined measures.
- Group the primary query by the `on` field and leave its alias as the
  field name; the join matches on that alias.
- `join.filters` applies only to the joined event.
- Joined aliases must not collide with primary aliases, can't be cost
  measures, and can't be used in `order_by`.

## 3. Send it

MCP: `query_project_analytics` with `project_id` plus the body, with three
keys in camelCase: `endExclusive`, `groupBy`, `orderBy`. Everything else,
including field names, stays as written.

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
  "rows": [{ "day": "2026-09-23", "traces": "120", "p95_ms": 840.5 }],
  "truncated": false,
  "window": { "start": "...", "end_exclusive": "..." }
}
```

- `rows`: one object per group, keyed by alias. With no `group_by`, one row.
- Large integer results, such as `count` and `sum` of token fields, can
  arrive as numeric strings. Parse them before doing math.
- Cost rows don't use your alias. See [Cost fields](#cost-fields).
- `truncated` is true when the row count reached `limit` (or 500). There may
  be more groups, or exactly that many. Narrow filters, use a coarser
  bucket, or raise `limit` and check again. Never present a truncated
  ranking as complete.
- `window` echoes the window that ran. Quote it in the answer.

### Cost fields

- `generation_cost`: each row gets `estimated_cost_usd` (null when unpriced)
  and `priced`.
- `trace_cost`: each row gets `estimated_cost_usd`, `cost_lower_bound`,
  `cost_lower_bound_reasons`, `cost_source`, `priced_tokens`,
  `total_tokens`, `priced_token_share`, `unpriced_models`,
  `pricing_fetched_at`, and `model_breakdown_truncated`, plus
  `attribution: { coverage, values }`. `values` maps model to estimated
  cost, and covers only traces priced at query time: `coverage` is `all`,
  `unwritten_only` (a partial per-model split), or `none`. Don't present a
  partial split as the full breakdown.

`cost_lower_bound_reasons` values: `unpriced_models`, `prices_unavailable`,
`unbackfilled_traces`, `live_priced_breakdown_truncated`,
`model_rollup_truncated`.

## 5. Recover from errors

| Response | Cause | Fix |
| --- | --- | --- |
| 400 | Invalid body; `detail` names the problem | Fix that part and retry once |
| Auth error | Missing, wrong, or ingest-only key | Ask for an organization key with read or admin scope |
| 404 | Unknown project, or a key limited to another project | Confirm the project id |
| Timeout | Query ran past 15s | Shorten the window, drop a group, or use a coarser bucket |
| 503 | Lemma unavailable | Retry once after a short wait, then tell the user |

400 `detail` messages and their fixes:

| `detail` | Fix |
| --- | --- |
| `Unknown field: x` | Use a field from that event in the catalog |
| `p95 is not valid for x` | The field is a string, or `aggs` lacks it |
| `count does not take a field` | Drop `field` |
| `trace_cost is not valid on tool.called` | Cost measures only work on their own event |
| `Only one cost measure is allowed` | Split into two queries |
| `generation_cost requires grouping by model` | Add `{ "field": "model" }` to `group_by` |
| `Invalid alias: x` | Lowercase letter first, then `[a-z0-9_]`, 41 max |
| `Duplicate alias: x` | Rename one |
| `Unknown order field: x` | Order by a group or primary measure alias |
| `start and endExclusive must be second-aligned UTC` | Drop milliseconds |
| `Window exceeds 90 days` | Split the window, see below |
| `in filters accept at most 20 values` | Split the list across queries |
| `Join must use a different event` | Pick another event, or use a measure `filter` |

## 6. Windows longer than the limit

Split the range into adjacent windows within 90 days, run one query per
window, then combine:

- `count`, `sum`: add across windows.
- `min`, `max`: take the min or max of the parts.
- `avg`: weight each part by its `count`. Add a `count` measure to every
  part so you can.
- `p50`, `p95`, `p99`, `uniqExact`: can't be combined. Report per window, or
  tell the user the overall figure isn't available over that range.
- Estimated cost: add `estimated_cost_usd`; carry over any `priced: false` or
  `cost_lower_bound: true`.

Analytics keeps 90 days, so a range reaching further back returns nothing
for the older part.
