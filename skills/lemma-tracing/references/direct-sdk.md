# Direct Lemma SDK Integration

Use this reference for manual TypeScript or Python integrations.

## Goal Shape

Produce one root trace per agent execution:

```text
support-agent              <- trace root (input, output, name, thread/user)
├── retrieve-context       <- span
│   └── search_docs        <- tool
└── answer                 <- generation
```

Required for useful Lemma analysis:

- Root trace has `name`, `input`, and final output or error.
- LLM calls are recorded as generations.
- Tool calls are recorded as tools.
- App work is recorded as spans.
- Related conversation turns share `threadId` / `thread_id`.

## Install and Client

TypeScript:

```bash
npm install @uselemma/tracing
```

```typescript
import { Lemma } from "@uselemma/tracing";

export const lemma = new Lemma();
```

Python:

```bash
pip install uselemma-tracing
```

```python
from uselemma_tracing import Lemma

lemma = Lemma()
```

Set:

```bash
LEMMA_API_KEY=...
LEMMA_PROJECT_ID=...
```

The SDK sends to `https://api.uselemma.ai/traces/ingest` by default. Use `baseUrl` / `base_url` only for staging or self-hosted deployments.

## Callback Trace

Use this when one function owns the whole run.

```typescript
const answer = await lemma.trace(
  {
    name: "support-agent",
    input: userMessage,
    threadId,
    userId,
  },
  async (trace) => {
    const docs = await searchDocs(userMessage);
    trace.recordTool({
      name: "search_docs",
      input: { query: userMessage },
      output: docs,
    });

    const response = await callModel(userMessage, docs);
    trace.recordGeneration({
      name: "answer",
      model: response.model,
      input: response.messages,
      output: response.text,
    });

    return response.text;
  },
);
```

Python:

```python
def run(trace):
    docs = search_docs(message)
    trace.record_tool(
        name="search_docs",
        input={"query": message},
        output=docs,
    )

    response = call_model(message, docs)
    trace.record_generation(
        name="answer",
        model=response.model,
        input=response.messages,
        output=response.text,
    )
    return response.text

answer = lemma.trace(
    "support-agent",
    run,
    input=message,
    thread_id=thread_id,
    user_id=user_id,
)
```

Callback traces measure duration automatically. Pass `durationMs` / `duration_ms` only when there is an external measurement you need to preserve.

## TypeScript Trace Handles

Use a TypeScript trace handle when the run is coordinated across helpers, streaming callbacks, or finalization hooks.

```typescript
const trace = lemma.trace({
  name: "support-agent",
  input: userMessage,
  threadId,
  userId,
});

const retrieve = trace.startSpan({
  name: "retrieve-context",
  input: { query: userMessage },
});

const docs = await searchDocs(userMessage);
retrieve.recordTool({
  name: "search_docs",
  input: { query: userMessage },
  output: docs,
});
retrieve.end({ output: { count: docs.length } });

const response = await callModel(userMessage, docs);
trace.recordGeneration({
  name: "answer",
  model: response.model,
  input: response.messages,
  output: response.text,
});

await trace.end({ output: response.text });
```

Do not invent a final trace duration before the work is done. The SDK knows the final elapsed time when `trace.end(...)` runs. Pass `durationMs` only if the application has already measured the completed operation.

## Live Handles for Work in Progress

Use start helpers when the work has not finished yet. These are available on the TypeScript trace handle and on the Python callback trace context.

```typescript
const tool = trace.startTool({
  name: "search_docs",
  input: { query },
});

try {
  const docs = await searchDocs(query);
  tool.end({ output: docs });
  return docs;
} catch (error) {
  tool.end({ error });
  throw error;
}
```

Equivalent helpers:

- TypeScript: `startSpan`, `startTool`, `startGeneration`
- Python: `start_span`, `start_tool`, `start_generation`

For already-completed work, use record helpers:

- TypeScript: `recordSpan`, `recordTool`, `recordGeneration`
- Python: `record_span`, `record_tool`, `record_generation`

## Detached Recording by ID

Use this TypeScript client pattern only when a helper cannot receive the trace object but can receive IDs.

```typescript
const trace = lemma.trace({ name: "support-agent", input });
const span = lemma.startSpan({
  traceId: trace.id,
  name: "retrieve-context",
});

lemma.recordTool({
  traceId: trace.id,
  parentSpanId: span.id,
  name: "search_docs",
  input: { query },
  output: docs,
});

span.end({ output: { count: docs.length } });
await trace.end({ output });
```

Detached child records require `traceId`. Pass `parentSpanId` when the record belongs under a span; otherwise the SDK cannot safely preserve nesting.

## Host + sandbox (one turn across processes)

`threadId` / `thread_id` is the multi-**turn** conversation key. Do not start one root per process and share `threadId` when the processes are really one user turn (host orchestrator + E2B-style sandbox). The sandbox must not hold `LEMMA_API_KEY` or call `/traces/ingest`. Ship the journal on the app's existing channel (E2B events, stdout, dump file). The host `apply`s it and `ingest()`s once.

TypeScript host + child (same shape as `packages/ts/tracing/examples/cross-process-turn.ts`):

```typescript
import { Lemma, attachTurn } from "@uselemma/tracing";

const lemma = new Lemma();

function runInSandbox(tokenJson: string, userMessage: string) {
  const local = attachTurn(tokenJson);
  local.recordTool({
    name: "search_docs",
    input: { query: userMessage },
    output: docs,
  });
  const generation = local.startGeneration({
    name: "answer",
    model: "gpt-4o",
    input: userMessage,
  });
  generation.end({ output: answer });
  return local.records();
}

const turn = lemma.startTurn({
  name: "agent-turn",
  input: userMessage,
  threadId,
  userId,
});
const sandbox = turn.startSpan({ name: "e2b-sandbox" });
const journal = runInSandbox(
  JSON.stringify(turn.export({ parentSpanId: sandbox.id })),
  userMessage,
);
turn.apply(journal);
sandbox.end({ output: { ok: true } });
await turn.end({ output: answer });
```

Python:

```python
import json
from uselemma_tracing import Lemma, attach_turn

lemma = Lemma()

def run_in_sandbox(token_json, user_message):
    local = attach_turn(token_json)
    local.record_tool(name="search_docs", input={"query": user_message}, output=docs)
    generation = local.start_generation(name="answer", model="gpt-4o", input=user_message)
    generation.end(output=answer)
    return local.records()

turn = lemma.start_turn("agent-turn", input=user_message, thread_id=thread_id, user_id=user_id)
sandbox = turn.start_span(name="e2b-sandbox")
journal = run_in_sandbox(json.dumps(turn.export(parent_span_id=sandbox.id)), user_message)
turn.apply(journal)
sandbox.end(output={"ok": True})
turn.end(output=answer)
```

`apply` also accepts a JSON string, one record, or an array of records if you stream events instead of one dump. `assembleTurn(token, journal)` / `assemble_turn(token, journal)` builds a `TraceContext` when the coordinator already has the dump and is not holding a live handle; then call `ingest()` once.

`turn.end()` / coordinator `ingest()` stays strict so a failed send can be retried. Re-applying the same journal does not duplicate spans (stable ids). If the child exits uncleanly, end the sandbox span as ERROR and `turn.fail(...)`; incomplete tools are allowed.

Standalone helpers: `startTurn` / `attachTurn` / `applyTurnJournal` (Python `start_turn` / `attach_turn` / `apply_turn_journal`). Instance aliases: `lemma.startTurn` / `lemma.attach` (Python `lemma.start_turn` / `Lemma.attach`).

## Native Contract Props

Prefer SDK props over hand-built attribute names:

- Generation: `model`, `llmInputMessages`, `llmOutputMessages`, `llmTools`, `llmInvocationParameters`, `llmPromptTemplate`, `llmPromptTemplateVariables`.
- Tool: `toolDescription`, `toolParameters`.
- Span: `embeddingModelName`, `embeddingInvocationParameters`, `rerankerInputDocuments`, `rerankerOutputDocuments`.
- Shared: `inputMimeType`, `outputMimeType`, `attributes`.

Python uses snake_case versions, for example `llm_input_messages` and `tool_parameters`.

## Debug Checklist

For missing traces, missing children, bad nesting, blank input/output, serverless finalization, or ingest failures, read [debug-mode.md](debug-mode.md). Use it as the diagnostic playbook before changing the integration shape.
