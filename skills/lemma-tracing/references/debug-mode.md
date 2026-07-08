# Debug Mode

Use this reference when a Lemma trace is missing, delayed, split into separate traces, individual spans show up as traces, spans are not nested properly, child spans are missing, tool/generation data is missing, or input/output is blank.

Debug mode is not just a switch to turn on. Use it to answer a sequence of questions:

1. Did the process that handles traffic create a trace?
2. Did the SDK try to send the completed payload?
3. Did ingest accept or reject it?
4. Did the payload include the child spans the user expected?
5. Are child spans attached to the correct parent?
6. If delivery worked, does the trace shape match the contract?

## Enable It

Enable debug mode before creating the Lemma client.

TypeScript:

```typescript
import { enableDebugMode, Lemma } from "@uselemma/tracing";

enableDebugMode();
const lemma = new Lemma();
```

Python:

```python
from uselemma_tracing import Lemma, enable_debug_mode

enable_debug_mode()
lemma = Lemma()
```

Environment:

```bash
LEMMA_DEBUG=1
```

`LEMMA_DEBUG=true` is also accepted for backwards compatibility.

Make sure the variable is set in the same runtime that serves traffic. In Next.js, serverless, workers, queues, and job processors, local shell variables often do not apply to the deployed process.

## Start With a Smoke Trace

Run the smallest trace from the same runtime where the real agent runs.

TypeScript:

```typescript
await lemma.trace({ name: "smoke-test", input: "hello" }, async () => "ok");
```

Python:

```python
lemma.trace("smoke-test", lambda trace: "ok", input="hello")
```

Expected callback trace:

```text
[LEMMA:client] trace started
[LEMMA:client] sending trace
[LEMMA:client] trace sent
```

Expected TypeScript trace handle:

```text
[LEMMA:client] trace handle created
[LEMMA:client] sending trace
[LEMMA:client] trace sent
```

If the smoke trace succeeds but the real agent does not, credentials and networking are probably fine. Move the debug check to the real code path and find the first missing log line.

## Read the First Missing Log

| What you see | What it means | What to do |
| --- | --- | --- |
| No Lemma logs | Debug mode is not enabled in this process, or the traced path is not running | Confirm env/config in the running server, job worker, or route handler; add a temporary app log next to `lemma.trace(...)` |
| `trace started`, but no `sending trace` | The callback did not finish, threw before flush, or an open handle was not ended/flushed | Await `lemma.trace(...)`; call and await `trace.end(...)`; inspect thrown errors and finalization callbacks |
| `trace handle created`, but no `sending trace` | A TypeScript handle exists but never reaches terminal finalization | End it from the final callback, stream terminal event, queue completion, or `finally` block |
| `sending trace`, then `trace ingest failed` | The SDK reached Lemma, but ingest rejected the request | Check status, response body, API key, project ID, `baseUrl`, and network policy |
| `trace sent`, but dashboard is wrong | Delivery worked; the payload shape is wrong or incomplete | Compare child count, parent IDs, and contract fields, then fix recording calls |

## Debug Missing Traces

1. Run the smoke trace in the target runtime.
2. If there are no SDK logs, the process is wrong or debug mode is not enabled.
3. If there is `trace ingest failed`, use the status/body:
   - `401` / `403`: API key, auth header, or project access.
   - `404`: wrong `baseUrl` or path.
   - `400`: malformed payload or project ID mismatch.
   - Network/DNS errors: egress or runtime network policy.
4. If `trace sent` appears but no dashboard trace appears, confirm the project ID and dashboard project match.

## Debug Span Shape Problems

Use this section first when the dashboard shows any of these:

- individual spans showing up as separate traces
- spans missing from the expected trace
- spans nested under the wrong parent
- tools or generations appearing as root-level siblings when they should be children
- a trace that has fewer children than the code path should produce

Debug mode is especially useful here because it logs span lifecycle events as
they happen, not only at final trace send time.

Run the real code path with debug mode enabled and compare:

1. The number of `span started`, `span ended`, and `span recorded` logs.
2. The `parentId` / `parent_id` shown in each span summary.
3. The final `spanCount` / `span_count` in the `sending trace` log.

Interpret the logs:

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| A child span appears as its own trace | The child was recorded outside the active root trace, or a helper created a new trace | Move the child recording inside `lemma.trace(...)`, pass the trace/span handle, or pass `traceId` and `parentSpanId` to detached helpers |
| A span is present but root-level instead of nested | The record call did not use the parent span handle and no `parentSpanId` was provided | Call `parent.recordTool(...)`, `parent.recordGeneration(...)`, or `parent.recordSpan(...)`; for detached helpers, pass `parentSpanId` |
| Expected span is absent and `spanCount` is too low | The recording code did not run, ran after the trace ended, or ran in a different async context | Add a temporary app log next to the recording call, keep it inside the trace callback, or end/flush only after child work completes |
| Debug logs show the span, but dashboard shape is still wrong | The span type or contract fields are wrong | Use typed helpers: `recordTool`, `recordGeneration`, `recordSpan`; include native fields like `model`, `input`, `output`, and `toolParameters` |

Correct nested handle pattern:

```typescript
const retrieve = trace.startSpan({ name: "retrieve-context" });
const docs = await searchDocs(query);
retrieve.recordTool({ name: "search_docs", input: { query }, output: docs });
retrieve.end({ output: { count: docs.length } });
```

Correct detached pattern:

```typescript
const retrieve = lemma.startSpan({
  traceId: trace.id,
  name: "retrieve-context",
});

lemma.recordTool({
  traceId: trace.id,
  parentSpanId: retrieve.id,
  name: "search_docs",
  input: { query },
  output: docs,
});
```

## Debug Split Traces or Lost Context

Symptom: each model/tool call appears as its own trace, or child work is missing from the root.

Use debug mode like this:

1. Confirm the real request logs one root `trace started` or `trace handle created`.
2. Confirm `sending trace` happens after the child work ran.
3. Check `spanCount` (`span_count` in Python). If the count is too low, the child recording code did not execute inside the active trace.
4. Check each span summary's `parentId` / `parent_id`. A missing parent ID means the span will be root-level inside the trace.
5. Move `recordTool(...)`, `recordGeneration(...)`, and `recordSpan(...)` inside the `lemma.trace(...)` callback, record from the parent span handle, or pass `traceId` / `parentSpanId` to detached helpers.

For TypeScript handles, make sure helpers receive the handle or IDs from the same root trace. For Python, keep the callback trace as the root boundary and record children on the callback trace context.

## Debug Missing Tools

Symptom: model calls show up, but tools are invisible or generic.

Use debug mode like this:

1. Add a temporary app log immediately before/after the tool function.
2. Add or inspect `trace.recordTool(...)` / `trace.record_tool(...)` after the tool returns.
3. Re-run with debug mode and check whether `spanCount` / `span_count` increases.
4. If the count increases but the dashboard still does not show a tool, confirm it uses the typed helper, not a generic span.

Correct shape:

```typescript
const docs = await searchDocs(query);
trace.recordTool({
  name: "search_docs",
  input: { query },
  output: docs,
});
```

For nested tools, call the helper from the parent span handle:

```typescript
const retrieve = trace.startSpan({ name: "retrieve-context" });
const docs = await searchDocs(query);
retrieve.recordTool({ name: "search_docs", input: { query }, output: docs });
retrieve.end({ output: { count: docs.length } });
```

## Debug Missing Generations or Content

Symptom: the trace exists, but model name, prompt/completion, or output text is missing.

Use debug mode like this:

1. Confirm the model call path runs before `sending trace`.
2. Check whether `spanCount` / `span_count` increases for the model call.
3. If it does not increase, add `recordGeneration(...)` / `record_generation(...)` or the Vercel AI `vercelAI()` integration.
4. If it increases but metadata is absent, include `model`, `input`, and `output`, or use native props such as `llmInputMessages` / `llm_input_messages`.

Correct shape:

```typescript
trace.recordGeneration({
  name: "answer",
  model: response.model,
  input: messages,
  output: response.text,
});
```

## Debug Blank Input or Output

Symptom: the trace renders but the root input/output is empty.

Use debug mode like this:

1. Confirm `sending trace` includes the expected trace name.
2. Inspect the call to `lemma.trace(...)` and verify `input` is set.
3. Verify the callback returns the user-visible final answer, or calls `trace.output(...)`.
4. For streaming, verify final output is set from the terminal event before the handle ends.

Correct callback shape:

```typescript
await lemma.trace({ name: "support-agent", input: userMessage }, async () => {
  const answer = await runAgent(userMessage);
  return answer;
});
```

Correct handle shape:

```typescript
const trace = lemma.trace({ name: "support-agent", input: userMessage });
const answer = await runAgent(userMessage, trace);
await trace.end({ output: answer });
```

## Debug Vercel AI SDK

For AI SDK v7, `vercelAI({ trace })` closes a trace handle from `onEnd`. For AI SDK v6, it closes from `onFinish`.

Use debug mode like this:

1. Confirm `trace started` for callback traces or `trace handle created` for streaming handle traces.
2. Confirm the AI SDK call includes the integration:
   - v7: `telemetry.integrations: [vercelAI()]`
   - v6: `experimental_telemetry.integrations: [vercelAI()]`
3. For streaming handles, confirm the terminal callback runs. If `sending trace` never appears, the stream did not reach `onEnd` / `onFinish` or the response path exited too early.
4. Check `spanCount` for one generation plus tool executions.

## Debug Serverless and Background Jobs

Symptom: traces are delayed, inconsistent, or missing only in production.

Use debug mode like this:

1. Confirm `trace sent` appears before the handler returns or the job exits.
2. Await `lemma.trace(...)`; do not fire and forget.
3. For TypeScript handles, call and await `trace.end(...)` in `finally` or the terminal callback.
4. Avoid recording child work after the root callback has returned unless using detached recording by ID and an explicit flush/end path.

## Finish With the Contract

After delivery works, debug mode has done its job. Finish by checking the trace shape:

- One root trace for one agent execution.
- Root has stable `name`, input, output or error, `threadId` / `userId` when available.
- LLM calls are typed generations with model, input/messages, and output text when available.
- Tool calls are typed tools with arguments and results.
- App work is spans, nested under the correct parent when relevant.
- `spanCount` / `span_count` roughly matches the number of child records expected.
