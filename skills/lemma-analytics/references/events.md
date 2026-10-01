# Events and fields

The live catalog (`describe_project_analytics`) is the source of truth. This
page explains what the fields mean, so you can map a question to one. If the
catalog and this page disagree, follow the catalog.

## How the catalog lists fields

- `dimensions` are string fields. Filter and group by them. They also accept
  `uniqExact`, even though the catalog doesn't list `aggs` for them.
- `measures` are numeric fields, each with the `aggs` it allows. Numeric
  fields accept `uniqExact`, `sum`, `avg`, `min`, `max`, `p50`, `p95`, and
  `p99`, unless `aggs` says otherwise. You can filter on them too.
- `count` belongs to no field. It counts rows.

## Fields on every event

`actor`, `surface`, `user_id`, `api_key_id`. These are strings that describe
where the event was recorded. Don't use them as agent or end-user identity
unless the user tells you what they hold in their project.

## `trace.processed`

One row per processed trace. Use it for runs, root latency, run-level errors,
tokens per run, and cost by agent.

| Field | Kind | Meaning |
| --- | --- | --- |
| `agent_name` | dimension | Agent that produced the trace; `''` when unset |
| `root_status_code` | dimension | Root span status; `''` when unknown |
| `root_duration_ms` | measure | Whole-run latency in milliseconds |
| `error_count` | measure | Error spans in the trace |
| `failing_tool_calls` | measure | Failed tool spans in the trace |
| `input_tokens`, `output_tokens` | measure | Tokens across the trace |
| `total_tokens` | measure | `input_tokens + output_tokens`; `sum` only |
| `estimated_cost_usd` | measure | Stored per-trace estimate; prefer `trace_cost` |

Latency on this event is `root_duration_ms`, not `duration_ms`. Cost measure:
`trace_cost`. The catalog also lists cost bookkeeping fields
(`estimated_cost_basis`, `cost_priced_tokens`, `cost_total_tokens`,
`cost_unpriced_models`, `model_tokens`, and truncation flags). Leave them
alone unless the user asks how cost was computed.

## `generation.completed`

One row per model call. Use it for model mix, model latency, throughput,
token use by model, and cost by model.

| Field | Kind | Meaning |
| --- | --- | --- |
| `model` | dimension | Model name; `''` when unknown |
| `trace_id`, `span_id` | dimension | The generation's trace and span |
| `duration_ms` | measure | Model call latency in milliseconds |
| `input_tokens`, `output_tokens` | measure | Tokens for this call |
| `tps` | measure | Output tokens per second; null when unknown |
| `error` | measure | `1` if the call failed, else `0` |

Cost measure: `generation_cost`. This event has no `agent_name`, so you can't
break model use down by agent.

## `tool.called`

One row per tool span.

| Field | Kind | Meaning |
| --- | --- | --- |
| `tool` | dimension | Tool name; `''` when unknown |
| `agent_name` | dimension | Agent of the trace the call ran in |
| `trace_id`, `span_id` | dimension | The call's trace and span |
| `duration_ms` | measure | Tool call latency in milliseconds |
| `output_tokens` | measure | Output tokens recorded on the span |
| `error` | measure | `1` if the call failed, else `0` |

## `span.errored`

One row per failed span, any kind.

| Field | Kind | Meaning |
| --- | --- | --- |
| `span_name` | dimension | Name of the failed span |
| `trace_id`, `span_id` | dimension | The failed span |

No `agent_name`. For errors by agent, use `error_count` or
`failing_tool_calls` on `trace.processed`, or `error` on `tool.called`.

## Issue lifecycle events

`issue.created`, `issue.resolved`, `issue.dismissed`, `issue.reopened`,
`issue.review_started`, `issue.flagged`, `issue.unflagged`,
`issue.slack_sent`. These carry only the fields on every event. Use `count`
with a time bucket, such as issues opened per week. For issue details, use
`lemma-mcp`.

## Join fields

A join matches on a field both events have. Useful pairs:

| Primary | Joined | `on` |
| --- | --- | --- |
| `trace.processed` | `tool.called` | `agent_name` |
| `tool.called` | `generation.completed` | `trace_id` |
| `tool.called` | `span.errored` | `trace_id` |

`trace.processed` has no queryable `trace_id`, so it can only join on
`agent_name` or the fields on every event.
