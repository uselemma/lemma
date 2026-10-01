# Preset views

A preset view returns one precomputed Analytics dashboard payload. Use one
when the user wants what a dashboard panel shows (an agent scorecard, a model
comparison, tool health, the headline numbers) rather than a custom
aggregate. One call can replace several queries, and the numbers match the
dashboard.

## Call

Each view has its own MCP tool. Over REST, pass the view name as `view` to
`GET /projects/{project_id}/analytics`. The `get_project_analytics` tool takes
`view` the same way.

| View | MCP tool | Window | Answers |
| --- | --- | --- | --- |
| `window` | `get_project_analytics_window` | Required | Headline numbers: latency p50/p95, error rate, coverage, estimated cost |
| `base` | `get_project_analytics_base` | Required | Series over time: traces, errors, tokens, cost, cost by model |
| `agent_scorecard` | `get_project_agent_scorecard` | Required | Per-agent volume, latency, error rate, tools, tokens, cost |
| `tool_aggregates` | `get_project_tool_aggregates` | Required | Per-tool calls, errors, latency; tool volume; error concentration |
| `model_scorecard` | `get_project_model_scorecard` | `start`, optional end | Per-model volume, tokens, speed, cost |
| `roi` | `get_project_roi` | None | Lemma's value: issues caught, resolved, dismissed; lifetime counts |

Parameters:

- `start`: inclusive, ISO-8601 UTC, whole second.
- `endExclusive`: exclusive end. Required for `window`, `base`,
  `agent_scorecard`, and `tool_aggregates`. REST also accepts
  `end_exclusive`.
- `end`: `model_scorecard` only, instead of `endExclusive`.
- `granularity`: `day` (default), `week`, or `month`. Use `day` up to a
  month, `week` for a quarter, `month` beyond.
- `roi` takes only `project_id` and returns about a year of daily series.

Unlike the query body, these are query parameters and use `endExclusive` in
camelCase on REST.

```bash
curl -s -G "https://api.uselemma.ai/projects/$LEMMA_PROJECT_ID/analytics" \
  -H "Authorization: Bearer $LEMMA_API_KEY" \
  --data-urlencode "view=agent_scorecard" \
  --data-urlencode "start=2026-09-23T00:00:00.000Z" \
  --data-urlencode "endExclusive=2026-09-30T00:00:00.000Z"
```

Older per-view REST paths such as `/projects/{project_id}/agent-scorecard`
are deprecated aliases. Use `?view=` instead.

## Responses

### `window`

- `totals`: `traces`, `p50`, `p95`, `error_rate` (null when unknown),
  `failed_runs`, `root_status_known`, `root_absent`
- `latency`: `granularity` and `points` of `{ date, p50, p95 }`
- `coverage`: `capability` (booleans: does the project emit `root_status`,
  `root_duration`, `agents`, `tokens`, `model`, `provider`, `cost_basis`,
  `tools` at all) and `window` (for each, `{ observed, eligible }` traces in
  this window), plus `window_traces`
- `cost`: estimated cost fields, with `cost_trace_counts` and truncation
  flags

Compare `root_status_known` with `traces`. When many traces have no root
status, the error rate rests on fewer traces than the total; say so.

### `base`

Date series for the window: `traces` (`{ date, value }`), `errors` (`date`,
`span_errors`, `failed_runs`, `root_status_known`, `root_absent`, `traces`),
`tokens` (`date`, `input_tokens`, `output_tokens`), `cost` (estimated cost
fields per date, with `traces`), and `cost_by_model` (`{ date, values }`
keyed by model). `cost_by_model_coverage` says how complete the per-model
split is; it covers only traces priced at query time.

### `agent_scorecard`

`rows`, one per agent: `agent`, `traces`, `p50`, `p95`, `error_rate`,
`root_status_known`, `tools_used` (with `tools_used_is_lower_bound`),
`tokens`, `cost` (with `cost_is_lower_bound`, `cost_lower_bound_reasons`,
`cost_source`), `model_breakdown_truncated`. Best first call for "how are my
agents doing".

### `tool_aggregates`

- `comparison`, one row per tool: `tool`, `calls`, `errors`, `error_rate`,
  `p50`, `p95`, `traces` (with `traces_is_lower_bound`), `output_tokens`
- `volume` and `failing_volume`: `{ date, values }` keyed by tool
- `error_concentration`: `rows` of `{ span_name, errors, rate }`, with
  `total_error_spans` and `truncated`

### `model_scorecard`

`rows`, one per model: `model`, `traces`, `tokens`, `input_tokens`,
`output_tokens`, `avg_speed`, `priced`, `estimated_cost_usd`. Top level adds
the overall estimated cost fields, `cost_rollup_truncated`, and
`cost_attribution_coverage`. Per-model `estimated_cost_usd` can be null when
part of the window's cost was priced at write time; the top-level total is
still complete. Check `cost_attribution_coverage`: `all` means the rows add
up to the total.

### `roi`

- `state`: `connect`, `waiting`, or `populated`. If it isn't
  `populated`, say the project has no analytics yet and stop.
- `counts`: lifetime `agents`, `lifetime_traces`, `issues`, `resolved`
- `base`: daily `{ date, value }` series for `caught`, `resolved`,
  `dismissed`, `traces`, `errors`, `artifact_iterations`, and
  `resolution_days`

## Reading preset responses

- Estimated cost fields: `estimated_cost_usd`, `priced_token_share`,
  `priced_tokens`, `total_tokens`, `unpriced_models`, `pricing_fetched_at`,
  `cost_source` (`stored`, `mixed`, or `query_time`), `cost_lower_bound`,
  `cost_lower_bound_reasons`, `model_breakdown_truncated`.
- Any `*_truncated` or `*_is_lower_bound` flag that is true means the figure
  is partial or a floor. Say so.
- `coverage` explains empty metrics. A capability that's `false`, or a low
  `observed / eligible`, means the traces don't send that field; see
  [reporting.md](reporting.md).
