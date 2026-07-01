import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Lemma, langChain, openAIAgents, vercelAI } from "./index";

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: any;
};

const servers: ReturnType<typeof createServer>[] = [];

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function startIngestServer() {
  const requests: CapturedRequest[] = [];
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(await readBody(request)),
      });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end("{}");
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("HTTP tracing integration", () => {
  it("sends callback, handle, detached-by-id, tool, and AI SDK payloads to the ingest endpoint", async () => {
    const ingest = await startIngestServer();
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: ingest.baseUrl,
    });

    await lemma.trace(
      { name: "callback-trace", input: "hi" },
      async (trace) => {
        trace.recordTool({
          name: "search_docs",
          input: { query: "hi" },
          output: ["doc"],
        });
        trace.recordGeneration({
          name: "draft-reply",
          output: "hello",
          model: "gpt-4o",
        });
        return "hello";
      },
    );

    const handled = lemma.trace({ name: "handle-trace", input: "hi" });
    const parent = handled.startSpan("retrieve-context");
    parent.recordTool("search_docs");
    parent.end({ output: { count: 1 } });
    await handled.end({ output: "hello" });

    const detached = lemma.trace({ name: "detached-trace" });
    const detachedParent = lemma.startSpan({
      traceId: detached.id,
      name: "parent-span",
    });
    lemma.recordTool({
      traceId: detached.id,
      parentSpanId: detachedParent.id,
      name: "detached-tool",
    });
    detachedParent.end();
    await detached.flush();

    const aiTrace = lemma.trace({ name: "ai-sdk-trace", input: "hi" });
    const integration = vercelAI({ trace: aiTrace });
    integration.onLanguageModelCallStart?.({
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    } as never);
    integration.onLanguageModelCallEnd?.({
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      content: [{ type: "text", text: "hello" }],
      performance: { responseTimeMs: 12 },
    } as never);
    await integration.onEnd?.({ text: "hello" });

    const openAIProcessor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: ingest.baseUrl,
    });
    await openAIProcessor.onTraceStart({
      traceId: "trace_openai",
      name: "openai-agents-trace",
    });
    await openAIProcessor.onSpanStart({
      traceId: "trace_openai",
      spanId: "span_openai_generation",
      spanData: { type: "generation", model: "gpt-4o" },
    });
    await openAIProcessor.onSpanStart({
      traceId: "trace_openai",
      spanId: "span_openai_tool",
      parentId: "span_openai_generation",
      spanData: { type: "function", name: "lookup", input: "{}" },
    });
    await openAIProcessor.onSpanEnd({
      traceId: "trace_openai",
      spanId: "span_openai_tool",
      parentId: "span_openai_generation",
      spanData: {
        type: "function",
        name: "lookup",
        input: "{}",
        output: '{"ok":true}',
      },
    });
    await openAIProcessor.onSpanEnd({
      traceId: "trace_openai",
      spanId: "span_openai_generation",
      spanData: {
        type: "generation",
        model: "gpt-4o",
        output: [{ role: "assistant", content: "hello" }],
      },
    });
    await openAIProcessor.onTraceEnd({
      traceId: "trace_openai",
      name: "openai-agents-trace",
    });

    const langChainHandler = langChain({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: ingest.baseUrl,
    });
    langChainHandler.handleChainStart(
      { name: "langchain-agent" },
      { input: "hi" },
      "chain-1",
    );
    langChainHandler.handleLLMStart(
      { name: "ChatOpenAI", kwargs: { model: "gpt-4o" } },
      ["hi"],
      "llm-1",
      "chain-1",
    );
    langChainHandler.handleLLMEnd(
      {
        generations: [[{ text: "hello" }]],
      },
      "llm-1",
    );
    await langChainHandler.handleChainEnd({ output: "hello" }, "chain-1");

    expect(ingest.requests).toHaveLength(6);
    for (const request of ingest.requests) {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/traces/ingest");
      expect(request.authorization).toBe("Bearer key");
      expect(request.body.project_id).toBe(
        "10000000-0000-0000-0000-000000000001",
      );
    }

    expect(ingest.requests[0].body.trace.spans).toMatchObject([
      { name: "search_docs", type: "tool" },
      { name: "draft-reply", type: "generation", model: "gpt-4o" },
    ]);

    expect(ingest.requests[1].body.trace.spans).toMatchObject([
      { name: "retrieve-context", type: "span", output: { count: 1 } },
      { name: "search_docs", type: "tool", parent_id: parent.id },
    ]);
    expect(ingest.requests[1].body.trace.spans[1]).not.toHaveProperty(
      "duration_ms",
    );

    expect(ingest.requests[2].body.trace.spans).toMatchObject([
      { id: detachedParent.id, name: "parent-span", type: "span" },
      { name: "detached-tool", type: "tool", parent_id: detachedParent.id },
    ]);

    expect(ingest.requests[3].body.trace).toMatchObject({
      name: "ai-sdk-trace",
      output: "hello",
    });
    expect(ingest.requests[3].body.trace.spans[0]).toMatchObject({
      name: "vercel-ai-generation",
      type: "generation",
      model: "gpt-4o",
      duration_ms: 12,
    });

    expect(ingest.requests[4].body.trace).toMatchObject({
      name: "openai-agents-trace",
    });
    expect(ingest.requests[4].body.trace.spans).toMatchObject([
      {
        id: "span_openai_generation",
        name: "openai-agents-generation",
        type: "generation",
        model: "gpt-4o",
      },
      {
        id: "span_openai_tool",
        parent_id: "span_openai_generation",
        name: "lookup",
        type: "tool",
        output: { ok: true },
      },
    ]);

    expect(ingest.requests[5].body.trace).toMatchObject({
      name: "langchain-agent",
      input: { input: "hi" },
      output: { output: "hello" },
    });
    expect(ingest.requests[5].body.trace.spans[0]).toMatchObject({
      name: "ChatOpenAI",
      type: "generation",
      model: "gpt-4o",
      output: "hello",
    });
  });
});
