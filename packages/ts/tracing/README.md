# @uselemma/tracing

HTTP tracing SDK for AI agents. No OpenTelemetry setup is required: the SDK sends trace payloads directly to the Lemma API.

## Installation

```bash
npm install @uselemma/tracing
```

## Quick Start

```typescript
import { Lemma } from "@uselemma/tracing";

const lemma = new Lemma({
  apiKey: process.env.LEMMA_API_KEY,
  projectId: process.env.LEMMA_PROJECT_ID,
  release: "1.8.3", // or set LEMMA_RELEASE
});

const answer = await lemma.trace(
  {
    name: "support-agent",
    input: userMessage,
    threadId: conversationId,
    userId: user.id,
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
      name: "draft-reply",
      input: response.messages,
      output: response.text,
      model: "gpt-4o",
    });

    return response.text;
  },
);
```

`trace()` creates one Lemma trace. The callback receives a context object; any child span, generation, or tool recorded through that context is attached to the trace.

Pass `release` (or set `LEMMA_RELEASE`) to stamp the running app version on every ingest payload. An explicit constructor value wins. Empty or invalid values are omitted.

## One-Off Events

Use one-off calls when the work already happened and you want to record it:

```typescript
trace.recordSpan({
  name: "rerank-results",
  input: { candidates: candidates.length },
  output: { kept: ranked.length },
});

trace.recordTool({
  name: "lookup_order",
  input: { orderId },
  output: order,
});

trace.recordGeneration({
  name: "answer",
  input: messages,
  output: text,
  model: "gpt-4o",
  durationMs: measuredModelMs,
  llmInputMessages: [{ role: "user", content: userMessage }],
  llmInvocationParameters: { temperature: 0.2 },
});
```

Pass contract fields as native props such as `llmInputMessages`, `llmInvocationParameters`, and `toolParameters`. Use `attributes` only when you need to send raw span attributes that do not yet have a native SDK prop.

### User-facing messaging tools

When a tool delivers the agent's response to the end user, pass the exact
display text as `userFacingMessage`. Lemma renders that text as an assistant
message while preserving the complete tool input and output in the span detail:

```typescript
const input = {
  message: "Your order arrives Friday.",
  sendAsVoiceNote: false,
  shouldTerminate: true,
};

trace.recordTool({
  name: "send_whatsapp",
  input,
  output: { delivered: true },
  userFacingMessage: input.message,
});
```

The tool's own schema can call the value `message`, `text`, `body`, or anything
else. Lemma never guesses which input field the user saw. Omit
`userFacingMessage` for internal tools; their payload and rendering are
unchanged.

## Live Spans

Use `startSpan()`, `startTool()`, or `startGeneration()` when you want the SDK to measure work from a handle and finish it later:

```typescript
const span = trace.startSpan({ name: "retrieve-context", input: query });
try {
  const docs = await retrieve(query);
  span.end({ output: docs });
} catch (error) {
  span.end({ error });
  throw error;
}
```

```typescript
const tool = trace.startTool({ name: "search_docs", input: { query } });
const docs = await searchDocs(query);
tool.end({ output: docs });

const generation = trace.startGeneration({
  name: "answer",
  input: messages,
  model: "gpt-4o",
});
const response = await callModel(messages);
generation.end({ output: response.text });
```

The SDK measures live handle durations from start and end timestamps. Pass `durationMs` only when replaying historical work or overriding the measured duration with a value from another timer. When child spans, generations, or tools omit `durationMs`, Lemma derives timing from timestamps during ingest.

You can also create a trace handle first and record work on it over time:

```typescript
const trace = lemma.trace({ name: "support-agent", input: userMessage });

const span = trace.startSpan("retrieve-context");
const docs = await retrieve(userMessage);
span.recordTool({
  name: "search_docs",
  input: { query: userMessage },
  output: docs,
  toolParameters: { query: "string" },
});
span.end({
  output: { count: docs.length },
});

await trace.end({ output: "final answer" });
```

For live trace handles, `trace.end({ output })` is usually enough. Pass `durationMs` to `trace.end()` only when you need to override the measured trace duration.

## Sending a Trace You Built Yourself

`trace()` and handles assume the client owns the trace lifecycle within a single process. When the producer lives elsewhere — a cross-process buffer, a queue worker, a batch backfill — build a `TraceContext` yourself and deliver it with `ingest()`:

```typescript
import { Lemma, TraceContext } from "@uselemma/tracing";

const lemma = new Lemma();

const context = new TraceContext({
  id: turnId, // stable id for this execution (use for retries)
  name: prompt,
  input: prompt,
  threadId: conversationId,
});
context.recordTool({ name: "search_docs", input, output, durationMs });
context.recordGeneration({ name: "answer", model: "gpt-4o", output });
context.output(finalAnswer);

await lemma.ingest(context, { startedAt });
```

`ingest()` POSTs one payload. Deliver **one complete trace** when the execution (agent turn) finishes: root input/output, thread/user, and all child spans in one call. This is required — patching a trace over time is not currently supported.

`ingest()` is not an incremental merge API: omitted root fields do not preserve prior values, and after Lemma processes the trace once, a later re-delivery does not re-run issue extraction (occasional late child spans may still append to the tree for display). Retries of the same complete payload are safe — already-stored span IDs are skipped — so a failed send can be retried as-is. It throws on a non-2xx response and never mutates the trace's status.

Automatic delivery (`trace(options, fn)` and `TraceHandle.end()`) fails open: a Lemma ingest 4xx/5xx or network error is logged in debug mode and dropped so it cannot fail the caller's application. Framework integrations that close through `end()` inherit this. Use `ingest()` when you need a failed send to throw so you can retry.

## Cross-process turns

When a user turn spans a host and a sandbox such as E2B, record one trace. Export a context token on the host. The child records a journal with no API key. The host applies the journal and `ingest()`s once.

```typescript
import { Lemma, attachTurn, startTurn } from "@uselemma/tracing";

const lemma = new Lemma();
const turn = startTurn(lemma, {
  name: "agent-turn",
  input: userMessage,
  threadId: conversationId,
});
const sandbox = turn.startSpan({ name: "e2b-sandbox" });

await e2b.run({
  env: {
    LEMMA_TURN: JSON.stringify(turn.export({ parentSpanId: sandbox.id })),
  },
});
for (const event of e2b.events) turn.apply(event);

sandbox.end();
await turn.end({ output }); // strict ingest: retry the same payload on failure
```

In the child process, do not construct `Lemma` and do not call `/traces/ingest`:

```typescript
import { attachTurn } from "@uselemma/tracing";

const local = attachTurn(process.env.LEMMA_TURN);
local.recordTool({ name: "search_docs", input: query, output: docs });
const generation = local.startGeneration({ name: "answer", model: "gpt-4o" });
generation.end({ output: answer });
process.stdout.write(JSON.stringify(local.records()));
```

Re-applying the same journal is idempotent (stable span ids). If the sandbox dies before a clean journal, end the host sandbox span as `ERROR`. Tools that started and never ended stay incomplete. `assembleTurn(token, journal)` builds a `TraceContext` when you already have the journal.

A longer host and child sample is in [`examples/cross-process-turn.ts`](./examples/cross-process-turn.ts).

## Coding Agent Harness Turns

Harness adapters receive prompts, tools, and responses as separate lifecycle
events, often in separate processes. The coding-agent helpers reduce those
events into a serializable turn and materialize one complete trace only after
the assistant response arrives:

```typescript
import {
  codingAgentTurnTrace,
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn,
} from "@uselemma/tracing";

let turn = startCodingAgentTurn({
  harness: "codex",
  sessionId,
  turnId,
  prompt,
  startedAt,
});
turn = recordCodingAgentToolStart(turn, toolStart);
turn = recordCodingAgentToolResult(turn, toolResult);
const completed = completeCodingAgentTurn(turn, { response, endedAt });
const trace = codingAgentTurnTrace(completed);

await lemma.ingest(trace.context, {
  startedAt: new Date(trace.startedAt),
  endedAt: new Date(trace.endedAt),
});
```

Each user turn is its own trace. `sessionId` becomes `thread_id`, so the turns
remain one conversation without delaying delivery until the harness session
closes. Persist the turn between events and retry only the same completed turn;
do not send partial snapshots to the append-only ingest endpoint. Default trace
and generation IDs are deterministic for the harness, session, and turn, so
replaying the same lifecycle stream produces the same payload identity.

Pass `generationStartedAt` and `generationEndedAt` to
`completeCodingAgentTurn` only when the harness exposes exact model-call
bounds. Without both values, the root still records the final response and the
assembler emits the typed generation with `timing_missing` metadata and omits
its timestamps instead of counting the whole turn as model latency. Missing
tool starts and results likewise omit unavailable timestamps and carry
`start_time_missing` or `result_missing` metadata; missing results are not
treated as execution errors unless the harness reports an error.

## Vercel AI SDK

Pass a fresh `vercelAI()` to the AI SDK telemetry integrations option for each operation. The integration creates and closes the Lemma trace for the AI SDK run, puts the current user turn on the root, promotes `threadId` / `userId` from telemetry metadata, and records model calls and tool executions as child spans. AI SDK v7 uses `telemetry`; AI SDK v6 uses `experimental_telemetry`.

```typescript
import { generateText } from "ai";
import { vercelAI } from "@uselemma/tracing";

const lemmaTelemetry = vercelAI({
  apiKey: process.env.LEMMA_API_KEY,
  projectId: process.env.LEMMA_PROJECT_ID,
});

try {
  const result = await generateText({
    model,
    prompt: userMessage,
    telemetry: {
      functionId: "support-agent",
      metadata: {
        threadId: conversationId,
        userId: user.id,
      },
      integrations: [lemmaTelemetry],
    },
  });
  await lemmaTelemetry.flush();
  return result.text;
} catch (error) {
  await lemmaTelemetry.fail(error);
  throw error;
}
```

For AI SDK v6, pass the same helper through `experimental_telemetry`:

```typescript
await generateText({
  model,
  prompt: userMessage,
  experimental_telemetry: {
    functionId: "support-agent",
    metadata: {
      threadId: conversationId,
      userId: user.id,
    },
    integrations: [lemmaTelemetry],
  },
});
```

Use `telemetry.functionId` / `experimental_telemetry.functionId` for the agent name, or set it on the integration with `vercelAI({ agentName: "support-agent" })`.

Prompts, tool inputs, outputs, model output text, and error messages are always recorded.

Call `fail(error)` when the AI SDK call throws before a terminal callback, then `flush()` to send the trace. Do not share one integration across concurrent AI SDK operations.

For advanced cases, you can still attach to an existing trace by passing `vercelAI({ trace })` or by calling AI SDK inside a `lemma.trace()` callback. When you pass a trace handle, the integration ends it from the AI SDK terminal callback: `onEnd` in AI SDK v7 and `onFinish` in AI SDK v6. When you use the callback form of `lemma.trace()`, the callback owns trace closure.

## OpenAI Agents SDK

Register the Lemma processor with the OpenAI Agents SDK tracing provider:

```typescript
import { addTraceProcessor } from "@openai/agents";
import { openAIAgents } from "@uselemma/tracing";

const processor = openAIAgents({
  metadata: { service: "support" },
});
addTraceProcessor(processor);
```

The processor creates one Lemma trace for each OpenAI Agents trace with root
current-turn input, final output or terminal error, promoted `threadId` /
`userId`, and wall-clock bounds from child spans. OpenAI generation/response
spans become Lemma generations, function spans become Lemma tool spans, and
other OpenAI Agents spans are preserved as regular spans.

Put conversation identity on the OpenAI Agents trace (`groupId` → `thread_id`,
metadata `userId` → `user_id`). Call `forceFlush()` to send the trace.

Function spans stay nested under their OpenAI parent span. To verify nesting
locally, enable debug mode and check that the tool span log includes the
generation span ID as `parentId`:

```typescript
import { enableDebugMode } from "@uselemma/tracing";

enableDebugMode();
```

Prompts, tool inputs, outputs, model output text, and error messages are always
recorded.

## LangChain and LangGraph

Pass `langChain()` as a LangChain callback handler. Each root run (chain, standalone
LLM/tool/retriever) owns one Lemma trace with current-turn input, final output or
root error, promoted `threadId` / `userId`, and real wall-clock bounds. Nested
chains, generations, tools, and retrievers keep typed parent IDs with orphan-safe
fallback. Call `flush()` to send the trace.

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { langChain } from "@uselemma/tracing";

const callbacks = [
  langChain({
    agentName: "support-agent",
    threadIdKey: "conversation_id",
    userIdKey: "user_id",
  }),
];

const model = new ChatOpenAI({
  model: "gpt-4o",
  callbacks,
});

const response = await model.invoke(userMessage, {
  metadata: { conversation_id: threadId, user_id: userId },
});
await callbacks[0].flush();
```

`langGraph()` is the same LangChain callback adapter with a LangGraph default
trace name (`langgraph-agent`):

```typescript
import { langGraph } from "@uselemma/tracing";

const result = await graph.invoke(
  { input: userMessage },
  { callbacks: [langGraph({ agentName: "support-graph" })] },
);
```

Prompts, tool inputs, outputs, model output text, and error messages are always
recorded.

When a helper only has IDs, use the client-level methods:

```typescript
const trace = lemma.trace();

const span = lemma.startSpan({ traceId: trace.id });
lemma.recordTool({
  traceId: trace.id,
  parentSpanId: span.id,
  name: "tool call",
});

await trace.end();
```

Detached handle calls require `traceId`. If a detached observation has a parent, pass `parentSpanId`; calls that cannot attach safely warn and no-op.

## Passing Trace Context

```typescript
import type { TraceContext } from "@uselemma/tracing";

export function recordSearch(trace: TraceContext, docs: unknown[]) {
  trace.recordTool({
    name: "search_docs",
    output: docs,
  });
}
```

Pass the `trace` or span handle into helpers that need to record child work. The SDK does not use ambient trace context because one process can coordinate multiple traces at once.

## Configuration

| Option      | Environment variable | Default                   |
| ----------- | -------------------- | ------------------------- |
| `apiKey`    | `LEMMA_API_KEY`      | Required                  |
| `projectId` | `LEMMA_PROJECT_ID`   | Required                  |
| `baseUrl`   | none                 | `https://api.uselemma.ai` |

The SDK sends to `${baseUrl}/traces/ingest`.

You can pass configuration directly to the constructor instead of using
environment variables:

```typescript
const lemma = new Lemma({
  apiKey: "sk_...",
  projectId: "proj_...",
  baseUrl: "https://api.uselemma.ai",
});
```

## Debug Mode

Debug mode logs trace starts, span starts, span completions, send attempts, and
send results as they happen:

```typescript
import { enableDebugMode } from "@uselemma/tracing";

enableDebugMode();
```

You can also set `LEMMA_DEBUG=1` (`true` also works). Use this when validating that spans arrive
in the expected order, parent IDs are attached, and the SDK is sending to the
right URL.

## Supported Contract Fields

Use native SDK props for OpenInference-style fields:

- LLM: `llmModelName`, `llmProvider`, `llmSystem`,
  `llmInvocationParameters`, `llmInputMessages`, `llmOutputMessages`,
  `llmTools`, `usage` (token counts when the provider supplies them — omit
  when unknown; never invent zeros), and prompt template fields.
- provenance: every span includes `lemma.sdk.language` and
  `lemma.sdk.integration` (`manual` by default; framework integrations override)
- tools: `toolName`, `toolDescription`, `toolParameters`, `userFacingMessage`
- embeddings and rerankers: `embeddingModelName`,
  `embeddingInvocationParameters`, `embeddingEmbeddings`,
  `rerankerModelName`, `rerankerInputDocuments`, `rerankerOutputDocuments`

Use `attributes` for raw attributes that do not yet have a native SDK prop.

## Documentation

- [Quickstart](https://docs.uselemma.ai/tracing/instrumentation/setup)
- [Trace contract](https://docs.uselemma.ai/reference/trace-contract)

## Examples

Runnable docs-chat agents for every first-party stack live in the repo-root
[`examples/`](../../../examples) directory. See
[Runnable examples](https://docs.uselemma.ai/guides/examples).

This package also ships SDK API snippets in [`examples/`](./examples) (callback
tracing, trace handles, record-by-ID, cross-process turns, and per-integration
wiring).

## License

MIT
