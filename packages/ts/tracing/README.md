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
  id: turnId, // stable id ties batches to one trace
  name: prompt,
  input: prompt,
  threadId: conversationId,
});
context.recordTool({ name: "search_docs", input, output, durationMs });
context.recordGeneration({ name: "answer", model: "gpt-4o", output });
context.output(finalAnswer);

await lemma.ingest(context, { startedAt });
```

`ingest()` is a single POST. Spans merge into the trace by id when `replace` is false (the default), so you can send a trace incrementally across several calls under one stable id and let the server reconcile them; pass `replace: true` to overwrite the trace wholesale. It throws on a non-2xx response and never mutates the trace's status, so a failed send can be retried as-is without fabricating an error.

## Vercel AI SDK

Pass `vercelAI()` to the AI SDK telemetry integrations option. The integration creates and closes the Lemma trace for the AI SDK run, extracts the prompt/messages as trace input, and records model calls and tool executions as child spans. AI SDK v7 uses `telemetry`; AI SDK v6 uses `experimental_telemetry`.

```typescript
import { generateText } from "ai";
import { vercelAI } from "@uselemma/tracing";

const lemmaTelemetry = vercelAI({
  apiKey: process.env.LEMMA_API_KEY,
  projectId: process.env.LEMMA_PROJECT_ID,
});

const result = await generateText({
  model,
  prompt: userMessage,
  telemetry: {
    functionId: "support-agent",
    integrations: [lemmaTelemetry],
  },
});

return result.text;
```

For AI SDK v6, pass the same helper through `experimental_telemetry`:

```typescript
await generateText({
  model,
  prompt: userMessage,
  experimental_telemetry: {
    functionId: "support-agent",
    integrations: [lemmaTelemetry],
  },
});
```

Use `telemetry.functionId` / `experimental_telemetry.functionId` for the agent name, or set it on the integration with `vercelAI({ agentName: "support-agent" })`.

Use `vercelAI({ recordInputs: false, recordOutputs: false })` to avoid sending prompts, tool inputs, tool outputs, or model output text.

For advanced cases, you can still attach to an existing trace by passing `vercelAI({ trace })` or by calling AI SDK inside a `lemma.trace()` callback. When you pass a trace handle, the integration ends it from the AI SDK terminal callback: `onEnd` in AI SDK v7 and `onFinish` in AI SDK v6. When you use the callback form of `lemma.trace()`, the callback owns trace closure.

## OpenAI Agents SDK

Register the Lemma processor with the OpenAI Agents SDK tracing provider:

```typescript
import { addTraceProcessor } from "@openai/agents";
import { openAIAgents } from "@uselemma/tracing";

addTraceProcessor(openAIAgents());
```

The processor creates one Lemma trace for each OpenAI Agents trace. OpenAI
generation spans become Lemma generations, function spans become Lemma tool
spans, and other OpenAI Agents spans are preserved as regular spans with the
original OpenAI trace/span fields in attributes.

Function spans stay nested under their OpenAI parent span. To verify nesting
locally, enable debug mode and check that the tool span log includes the
generation span ID as `parentId`:

```typescript
import { enableDebugMode } from "@uselemma/tracing";

enableDebugMode();
```

Use `openAIAgents({ recordInputs: false, recordOutputs: false })` to avoid
sending prompts, tool inputs, tool outputs, or model output text.

## LangChain and LangGraph

Pass `langChain()` as a LangChain callback handler. The handler creates one
Lemma trace for the root run, records LLM calls as generations, tools as tool
spans, retrievers as spans, and nested chains as child spans.

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { langChain } from "@uselemma/tracing";

const model = new ChatOpenAI({
  model: "gpt-4o",
  callbacks: [langChain({ agentName: "support-agent" })],
});

const response = await model.invoke(userMessage);
```

LangGraph uses LangChain callbacks too:

```typescript
import { langGraph } from "@uselemma/tracing";

const result = await graph.invoke(
  { input: userMessage },
  { callbacks: [langGraph({ agentName: "support-graph" })] },
);
```

Use `langChain({ recordInputs: false, recordOutputs: false })` or
`langGraph({ recordInputs: false, recordOutputs: false })` to avoid sending
prompts, tool inputs, tool outputs, or generated text.

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
  `llmTools`, token counts, and prompt template fields
- tools: `toolName`, `toolDescription`, `toolParameters`
- embeddings and rerankers: `embeddingModelName`,
  `embeddingInvocationParameters`, `embeddingEmbeddings`,
  `rerankerModelName`, `rerankerInputDocuments`, `rerankerOutputDocuments`

Use `attributes` for raw attributes that do not yet have a native SDK prop.

## Documentation

- [Quickstart](https://docs.uselemma.ai/getting-started/quickstart)
- [Trace contract](https://docs.uselemma.ai/reference/trace-contract)

## Examples

See [`examples/`](./examples) for complete callback tracing, trace handle,
record-by-ID, Vercel AI SDK v6/v7, OpenAI Agents SDK, LangChain, and LangGraph
examples.

## License

MIT
