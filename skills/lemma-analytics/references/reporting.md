# Reporting results

## Shape of the answer

1. Lead with the answer in one sentence, with the number.
2. State the window in UTC with the end exclusive, and any filter, such as
   "Sep 23 to Sep 30 (exclusive), support_agent only".
3. Show the breakdown as a table when there's more than one row. Columns are
   your aliases in plain words, plus any figure you derived.
4. Close with caveats that change how to read the number: truncation,
   estimated cost, unpriced models, lower bounds, small samples, partial
   final bucket.
5. Offer one next step that follows from the result, such as a breakdown,
   a comparison window, or the traces behind a spike. Don't run it unasked.

Example:

> support_agent ran 842 traces from Sep 23 to Sep 30 (exclusive), with a p95
> of 1.9s.
>
> | Day | Traces | p95 |
> | --- | --- | --- |
> | Sep 23 | 120 | 0.8s |
> | ... | ... | ... |
>
> Sep 27 is the outlier at 4.2s p95. Want me to break that day down by tool?

## Numbers

- Durations: fields ending `_ms` are milliseconds. Show seconds with one
  decimal at 1s and above, otherwise milliseconds.
- Rates: compute from counts you queried, show as a percent with one
  decimal, and keep the counts nearby, such as "4.5% (18 of 400)".
- Cost: US dollars, two decimals, or four below $0.01. Prefix the first
  mention with "estimated".
- Changes: absolute and percent, such as "up 120 traces (+14%)". Skip the
  percent when the base is under about 20.
- Never round a count.

## Empty and partial results

| What you see | What to say |
| --- | --- |
| No rows | Nothing matched in the window. Check the filter value and window before concluding there was no traffic |
| `truncated: true` | The list is partial; give the cap and offer to narrow |
| A percentile or avg is null or 0 with few rows | The field is mostly missing in that group. Usually missing telemetry, not zero latency |
| A group named `""` | Rows without that field set, such as traces with no agent name. Label it "unnamed" |
| Cost with `priced: false` | Lemma has no list price for that model; total excludes it |
| `cost_lower_bound: true` | The estimate can be low; give `cost_lower_bound_reasons` |
| Preset `state` isn't `populated` | The project has no analytics yet |

## Missing telemetry

Lemma treats a missing field as "not instrumented" and an explicit `0` as a
real zero. An empty latency, token, or cost figure usually means the SDK
isn't sending that field. The ones analytics depends on:

| Metric | Needs on the trace |
| --- | --- |
| Model and cost | Generation `model` and token `usage` |
| Root latency | Trace `duration_ms` (or start and end) |
| Error rate | `status: "ERROR"` on the root or tool span |
| Tool breakdowns | Tool spans with a name under the trace |

To confirm, call the `window` view and read `coverage`: a `false` capability,
or a low `observed / eligible` ratio for the window, names the gap.

When a metric is empty for this reason, say which field is missing and offer
`lemma-diagnostics` to confirm it, then `lemma-tracing` to add it. Don't
claim an outage from an empty chart.

## Going from a number to evidence

Analytics covers 90 days; individual traces are kept for 14. A spike older
than 14 days can't be opened as traces. For a recent spike, offer to pull the
traces in that window and filter (trace tools on the Lemma MCP). For a
recurring failure, offer `lemma-mcp` to check whether Lemma already opened an
issue for it.
