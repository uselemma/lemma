# Vercel AI SDK

Use this reference when the app uses Vercel AI SDK v7 or v6.

## Decision Path

1. Detect AI SDK version from package files and call shape.
2. Use `vercelAI()` so the AI SDK run becomes one Lemma trace, model calls become Lemma generations, and tool executions become Lemma tool calls.
3. Create a **new** `vercelAI()` integration per AI SDK operation. Do not share one instance across concurrent runs.
4. Provide a stable agent name through the AI SDK `functionId` or `vercelAI({ agentName })`.
5. Put `threadId` and `userId` in telemetry metadata so Lemma promotes them onto the root trace.
6. Call `flush()` after the operation (especially streaming / serverless). Use `fail(error)` when the call throws before a terminal callback.
7. Only pass an explicit trace handle for advanced externally coordinated work.
8. Verify with debug mode and a real AI SDK call.

Do not use Langfuse as the integration layer for Lemma work. If the app already has Langfuse, keep it only if the customer still needs Langfuse data, and add Lemma SDK tracing alongside it. Langfuse instrumentation alone is not sufficient for Lemma because it usually does not produce the Lemma trace contract.

Docs:

- `https://docs.uselemma.ai/integrations/vercel-ai.md`
- `https://docs.uselemma.ai/tracing/instrumentation/traces.md`
- `https://docs.uselemma.ai/tracing/troubleshooting/debug-mode.md`
- `https://docs.uselemma.ai/reference/trace-contract.md`

## Install

```bash
npm install @uselemma/tracing ai zod
```

Use server-side environment variables:

```bash
LEMMA_API_KEY=...
LEMMA_PROJECT_ID=...
```

Never expose `LEMMA_API_KEY` to browser code or `NEXT_PUBLIC_*`.

## AI SDK v7

Use `telemetry.integrations`. Instantiate `vercelAI()` per operation.

```typescript
import { generateText, tool } from "ai";
import { z } from "zod";
import { vercelAI } from "@uselemma/tracing";

const lemmaTelemetry = vercelAI();

try {
  const result = await generateText({
    model,
    prompt: userMessage,
    tools: {
      searchDocs: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => searchDocs(query),
      }),
    },
    telemetry: {
      functionId: "support-agent",
      metadata: { threadId: conversationId, userId },
      integrations: [lemmaTelemetry],
    },
  });
  await lemmaTelemetry.flush();
  const answer = result.text;
} catch (error) {
  await lemmaTelemetry.fail(error);
  throw error;
}
```

## AI SDK v6

Use `experimental_telemetry.integrations`.

```typescript
import { generateText, tool } from "ai";
import { z } from "zod";
import { vercelAI } from "@uselemma/tracing";

const lemmaTelemetry = vercelAI();

try {
  const result = await generateText({
    model,
    prompt: userMessage,
    tools: {
      searchDocs: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => searchDocs(query),
      }),
    },
    experimental_telemetry: {
      functionId: "support-agent",
      metadata: { threadId: conversationId, userId },
      integrations: [lemmaTelemetry],
    },
  });
  await lemmaTelemetry.flush();
  const answer = result.text;
} catch (error) {
  await lemmaTelemetry.fail(error);
  throw error;
}
```

## Streaming

For normal streaming, use `vercelAI()` in telemetry and let the integration close the trace from the AI SDK terminal callback:

- AI SDK v7: `onEnd`
- AI SDK v6: `onFinish`

Then `await lemmaTelemetry.flush()` after the stream completes.

```typescript
import { streamText } from "ai";
import { vercelAI } from "@uselemma/tracing";

const lemmaTelemetry = vercelAI();

const result = streamText({
  model,
  prompt: userMessage,
  telemetry: {
    functionId: "support-agent",
    metadata: { threadId: conversationId, userId },
    integrations: [lemmaTelemetry],
  },
});

for await (const part of result.fullStream) {
  // stream to the response
}

await lemmaTelemetry.flush();
```

If the app uses AI SDK v6 streaming syntax, keep its existing stream handling but put `vercelAI()` under `experimental_telemetry.integrations`.

For advanced externally coordinated work, you may pass a trace handle to `vercelAI({ trace })`. In that case, do not also wrap the run in callback-form `lemma.trace(...)`.

## Recording Controls

Disable captured prompts, tool inputs, tool outputs, or model output text when needed. Structure and status remain:

```typescript
telemetry: {
  integrations: [
    vercelAI({
      recordInputs: false,
      recordOutputs: false,
    }),
  ],
}
```

## What Lemma Records

| AI SDK event | Lemma record |
| --- | --- |
| Run | Root with current-turn input, final answer or root error, `thread_id` / `user_id`, real wall times |
| Model call | Generation with model, provider, normalized messages, structured assistant output, and duration when available |
| Tool execution | Tool call with name, input, output or error, and duration when available |

AI SDK v7 provides model and tool durations directly. AI SDK v6 provides tool execution durations; model-call durations may be inferred by Lemma from start/finish timestamps. v6 `system` + `prompt` are normalized into chat messages.

## Debugging

Use [debug-mode.md](debug-mode.md) when Vercel AI traces are missing or incomplete.

For AI SDK-specific debugging:

- Expect `trace started` for managed traces or `trace handle created` for explicit handle traces.
- Expect `sending trace` followed by `trace sent`.
- Confirm `spanCount` includes the model generation and any tool executions.
- Confirm root `thread_id` / `user_id` when metadata was provided.
- If streaming never sends, confirm the terminal callback (`onEnd` in v7, `onFinish` in v6) runs and that `flush()` / `shutdown()` was awaited in short-lived runtimes.
- If you see concurrent-reuse errors, create a new `vercelAI()` per operation instead of sharing one instance.
