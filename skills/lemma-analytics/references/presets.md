# Preset views

`get_project_analytics` returns one precomputed Analytics dashboard panel.
Use it when the user wants what a dashboard panel shows (an agent scorecard,
a model comparison, tool health) rather than one custom aggregate. One call
can replace several queries, and the numbers match the dashboard.

## Call

MCP: one tool per view; pick the one matching the view below from the tool
list, and pass `project_id` plus the window.

REST:

```bash
curl -s -G "https://api.uselemma.ai/projects/$LEMMA_PROJECT_ID/analytics" \
  -H "Authorization: Bearer $LEMMA_API_KEY" \
  --data-urlencode "view=agent_scorecard" \
  --data-urlencode "start=2026-09-23T00:00:00.000Z" \
  --data-urlencode "endExclusive=2026-09-30T00:00:00.000Z"
```

| Parameter | Notes |
| --- | --- |
| `view` | `base`, `window`, `model_scorecard`, `agent_scorecard`, `tool_aggregates`, or `roi` |
| `start` | Inclusive window start, ISO-8601 |
| `endExclusive` | Exclusive end. Required for `base`, `window`, `agent_scorecard`, and `tool_aggregates` |
| `end` | Optional inclusive end, instead of `endExclusive` |
| `granularity` | `day`, `week`, or `month`, for views with series |

These are query parameters, and `endExclusive` is camelCase even on REST,
unlike the query body. The live list of views is the `view` enum on
[Get project analytics](https://docs.uselemma.ai/api-reference/projects/get-project-analytics);
trust it over this table if they differ.

Pick a granularity that keeps the series readable: `day` up to a month,
`week` for a quarter, `month` beyond. Analytics looks back 90 days on a
rolling basis.

## Views

### `agent_scorecard`

`rows`, one per agent: `agent`, `traces`, `p50`, `p95`, `error_rate`,
`tools_used`, `tokens`, `cost`, and lower-bound flags (`tools_used_is_lower_bound`,
`cost_is_lower_bound`, `cost_lower_bound_reasons`). Best first call for "how
are my agents doing".

### `model_scorecard`

`rows`, one per model: `model`, `traces`, `tokens`, `input_tokens`,
`output_tokens`, `avg_speed`, `priced`, `estimated_cost_usd`. Top level adds
the overall `estimated_cost_usd`, `priced_token_share`, `unpriced_models`,
`cost_lower_bound`, and truncation flags.

### `tool_aggregates`

- `comparison`, one row per tool: `tool`, `calls`, `errors`, `error_rate`,
  `p50`, `p95`, `traces`, `output_tokens`
- `volume` and `failing_volume`: per-date series of calls by tool
- `error_concentration.rows`: `span_name`, `errors`, `rate`, with
  `total_error_spans` and `truncated`

### `base`

Project overview: `state` (`connect`, `waiting`, or `populated`), lifetime
`counts` (`agents`, `lifetime_traces`, `issues`, `resolved`), and `base`
date series (issues caught, resolved, dismissed, traces, errors, and more).
If `state` isn't `populated`, the project has no analytics yet; say so and
stop.

### `window` and `roi`

Window-level series and totals: trace and error series, latency
percentiles, error rate, tokens, estimated cost, cost by model, and coverage
of each telemetry capability. Call the view and read the keys it returns
rather than assuming a shape.

## Reading preset responses

- Series come as `[{ date, value }]` or `[{ date, values }]` keyed by tool or
  model.
- `cost_source` is `stored`, `mixed`, or `query_time`. Mention it only when
  the user asks how cost was computed.
- `coverage` objects say which capabilities (root status, durations, tokens,
  model, provider, tools) the traces emit. A capability that's missing
  explains an empty metric; see [reporting.md](reporting.md).
- Any `*_truncated` or `*_is_lower_bound` flag that is true means the figure
  is partial or a floor. Say so.
