import { describe, expect, it, vi } from "vitest";
import { Lemma, TraceContext } from "./client";
import { disableDebugMode, enableDebugMode } from "./debug-mode";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("Lemma", () => {
  it("posts a completed trace with one-off generation and tool events", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: "https://api.example.test/",
      fetch: fetchMock as typeof fetch,
    });

    const result = await lemma.trace(
      {
        name: "support-agent",
        durationMs: 1234,
        input: "where is my order?",
        threadId: "thread-1",
        userId: "user-1",
      },
      async (trace) => {
        trace.recordTool({
          name: "search_docs",
          input: { query: "order" },
          output: { status: "shipped" },
          durationMs: 25,
          toolParameters: { query: "string" },
        });
        trace.recordGeneration({
          name: "draft-reply",
          input: "prompt",
          output: "answer",
          model: "gpt-4o",
          durationMs: 40,
          llmInvocationParameters: { temperature: 0.2 },
          llmInputMessages: [{ role: "user", content: "where is my order?" }],
        });
        return "it arrives Friday";
      },
    );

    expect(result).toBe("it arrives Friday");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/traces/ingest",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer key",
          "Content-Type": "application/json",
        }),
      }),
    );

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.project_id).toBe("10000000-0000-0000-0000-000000000001");
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: "where is my order?",
      output: "it arrives Friday",
      thread_id: "thread-1",
      user_id: "user-1",
      duration_ms: 1234,
    });
    expect(body.trace.spans).toMatchObject([
      {
        name: "search_docs",
        type: "tool",
        input: { query: "order" },
        output: { status: "shipped" },
        duration_ms: 25,
        attributes: {
          "tool.parameters": JSON.stringify({ query: "string" }),
        },
      },
      {
        name: "draft-reply",
        type: "generation",
        model: "gpt-4o",
        duration_ms: 40,
        attributes: {
          "llm.invocation_parameters": JSON.stringify({ temperature: 0.2 }),
          "llm.input_messages.0.message.role": "user",
          "llm.input_messages.0.message.content": "where is my order?",
          "llm.model_name": "gpt-4o",
        },
      },
    ]);
  });

  it("supports live span handles", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const span = trace.startSpan({ name: "retrieve", input: "q" });
      span.end({
        output: ["doc"],
        durationMs: 250,
      });
      return "ok";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      name: "retrieve",
      type: "span",
      input: "q",
      output: ["doc"],
      duration_ms: 250,
    });
    expect(body.trace.spans[0].id).toEqual(expect.any(String));
  });

  it("supports trace handles with nested span methods", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const trace = lemma.trace({ name: "support-agent", input: "hi" });
    const span = trace.startSpan("parent span");
    span.recordTool("tool call");
    span.recordGeneration({ name: "answer", model: "gpt-4o", output: "hello" });
    span.end({ output: "done" });
    await trace.end({ output: "hello", durationMs: 321 });

    const body = jsonBody(fetchMock.mock.calls.at(-1)!);
    expect(body.replace).toBe(true);
    expect(body.trace.id).toBe(trace.id);
    expect(body.trace.output).toBe("hello");
    expect(body.trace.duration_ms).toBe(321);
    expect(body.trace.spans).toMatchObject([
      {
        id: span.id,
        name: "parent span",
        type: "span",
        output: "done",
      },
      {
        parent_id: span.id,
        name: "tool call",
        type: "tool",
      },
      {
        parent_id: span.id,
        name: "answer",
        type: "generation",
        model: "gpt-4o",
      },
    ]);
    expect(body.trace.spans[1]).not.toHaveProperty("duration_ms");
    expect(body.trace.spans[2]).not.toHaveProperty("duration_ms");
  });

  it("supports live tool and generation handles", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const tool = trace.startTool({
        name: "search_docs",
        input: { query: "order" },
      });
      tool.end({ output: [{ title: "Shipping" }], durationMs: 25 });

      const generation = trace.startGeneration({
        name: "answer",
        model: "gpt-4o",
        input: "prompt",
      });
      generation.end({ output: "It arrives Friday.", durationMs: 40 });

      return "ok";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans).toMatchObject([
      {
        id: expect.any(String),
        name: "search_docs",
        type: "tool",
        input: { query: "order" },
        output: [{ title: "Shipping" }],
        duration_ms: 25,
      },
      {
        id: expect.any(String),
        name: "answer",
        type: "generation",
        model: "gpt-4o",
        input: "prompt",
        output: "It arrives Friday.",
        duration_ms: 40,
      },
    ]);
  });

  it("supports no-argument trace handles with nested shorthand observations", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const trace = lemma.trace();
    const span = trace.startSpan("parent span");
    span.recordTool("tool call");
    await trace.flush();

    const body = jsonBody(fetchMock.mock.calls.at(-1)!);
    expect(body.trace).toMatchObject({
      id: trace.id,
      name: "trace",
    });
    expect(body.trace.spans).toMatchObject([
      {
        id: span.id,
        name: "parent span",
        type: "span",
      },
      {
        parent_id: span.id,
        name: "tool call",
        type: "tool",
      },
    ]);
    expect(body.trace.spans[0]).not.toHaveProperty("duration_ms");
    expect(body.trace.spans[1]).not.toHaveProperty("duration_ms");
  });

  it("does not send a trace handle until it is ended", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const trace = lemma.trace({ name: "support-agent" });
    const span = trace.startSpan("parent span");
    span.recordTool("tool call");
    span.end();

    // Recording spans must not stream partial snapshots; nothing is sent until
    // the trace is explicitly ended.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();

    await trace.end({ output: "done" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.id).toBe(trace.id);
    expect(body.trace.output).toBe("done");
    expect(body.trace.spans).toHaveLength(2);
  });

  it("does not resend a trace when end() is called more than once", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const trace = lemma.trace({ name: "support-agent" });
    trace.startSpan("parent span").end();

    await trace.end({ output: "done" });
    await trace.end({ output: "ignored" });

    // A second end() is a no-op: the append-only ingest API would otherwise
    // duplicate every span on the re-send.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonBody(fetchMock.mock.calls[0]).trace.output).toBe("done");
  });

  it("supports client-level detached observations by trace id", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const trace = lemma.trace();
    const span = lemma.startSpan({ traceId: trace.id });
    lemma.recordTool({
      traceId: trace.id,
      parentSpanId: span.id,
      name: "tool call",
    });
    span.end();
    await trace.flush();

    const body = jsonBody(fetchMock.mock.calls.at(-1)!);
    expect(body.trace.name).toBe("trace");
    expect(body.trace.spans).toMatchObject([
      {
        id: span.id,
        name: "span",
        type: "span",
      },
      {
        parent_id: span.id,
        name: "tool call",
        type: "tool",
      },
    ]);
  });

  it("warns and no-ops detached observations without a trace id", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const span = lemma.recordSpan({ name: "orphan" });
    lemma.recordTool({ name: "orphan tool" });
    lemma.recordGeneration({ name: "orphan generation" });

    expect(span.id).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "@uselemma/tracing: span handle requires traceId; skipping span",
    );
    expect(warn).toHaveBeenCalledWith(
      "@uselemma/tracing: tool handle requires traceId; skipping tool",
    );
    expect(warn).toHaveBeenCalledWith(
      "@uselemma/tracing: generation handle requires traceId; skipping generation",
    );

    warn.mockRestore();
  });

  it("warns and no-ops detached observations for unknown trace ids", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const span = lemma.startSpan({ traceId: "missing-trace", name: "orphan" });

    expect(span.id).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '@uselemma/tracing: unknown trace id "missing-trace"; skipping span',
    );

    warn.mockRestore();
  });

  it("warns and no-ops detached child observations without parentSpanId", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const trace = lemma.trace();
    const span = lemma.startSpan({
      traceId: trace.id,
      parentId: "parent-span",
      name: "child span",
    });
    lemma.recordTool({
      traceId: trace.id,
      parentId: "parent-span",
      name: "child tool",
    });
    await trace.flush();

    const body = jsonBody(fetchMock.mock.calls.at(-1)!);
    expect(span.id).toBe("");
    expect(body.trace.spans).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "@uselemma/tracing: span has a parent, but parentSpanId was not provided; skipping span",
    );
    expect(warn).toHaveBeenCalledWith(
      "@uselemma/tracing: tool has a parent, but parentSpanId was not provided; skipping tool",
    );

    warn.mockRestore();
  });

  it("flushes failed traces and rethrows the original error", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      lemma.trace("support-agent", async (trace) => {
        trace.recordTool({ name: "lookup", error: new Error("missing") });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.status).toBe("ERROR");
    expect(body.trace.error).toBe("boom");
    expect(body.trace.spans[0]).toMatchObject({
      name: "lookup",
      type: "tool",
      status: "ERROR",
      error: "missing",
    });
  });

  it("surfaces ingest failures", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      lemma.trace("support-agent", async () => "ok"),
    ).rejects.toThrow("failed to ingest trace (503): nope");
  });

  it("ingest sends a self-built trace once, merging by default", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: "https://api.example.test/",
      fetch: fetchMock as typeof fetch,
    });

    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const context = new TraceContext({
      id: "trace-1",
      name: "cursor-agent-turn",
      input: "do the thing",
      threadId: "conv-1",
    });
    context.recordTool({ name: "search_docs", durationMs: 25 });
    context.output("done");

    await lemma.ingest(context, { startedAt });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/traces/ingest",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.replace).toBe(false);
    expect(body.project_id).toBe("10000000-0000-0000-0000-000000000001");
    expect(body.trace).toMatchObject({
      id: "trace-1",
      name: "cursor-agent-turn",
      input: "do the thing",
      thread_id: "conv-1",
      output: "done",
      started_at: "2026-01-01T00:00:00.000Z",
    });
    expect(body.trace.spans).toMatchObject([{ name: "search_docs", type: "tool" }]);
  });

  it("ingest replaces the trace when asked", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const context = new TraceContext({ id: "trace-1", name: "t" });
    await lemma.ingest(context, { startedAt: new Date(), replace: true });

    expect(jsonBody(fetchMock.mock.calls[0]).replace).toBe(true);
  });

  it("ingest merges incrementally across calls under one stable id", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const startedAt = new Date("2026-01-01T00:00:00.000Z");

    // Two independently-built contexts standing in for two processes/batches.
    const first = new TraceContext({ id: "trace-1", name: "turn" });
    first.recordGeneration({ name: "draft", model: "gpt-4o" });
    await lemma.ingest(first, { startedAt });

    const second = new TraceContext({ id: "trace-1", name: "turn" });
    second.recordTool({ name: "lookup" });
    await lemma.ingest(second, { startedAt });

    const a = jsonBody(fetchMock.mock.calls[0]);
    const b = jsonBody(fetchMock.mock.calls[1]);
    expect(a.replace).toBe(false);
    expect(b.replace).toBe(false);
    expect(a.trace.id).toBe("trace-1");
    expect(b.trace.id).toBe("trace-1");
    expect(a.trace.started_at).toBe(b.trace.started_at);
    expect(a.trace.spans).toMatchObject([{ name: "draft", type: "generation" }]);
    expect(b.trace.spans).toMatchObject([{ name: "lookup", type: "tool" }]);
  });

  it("ingest throws on a non-2xx response so the caller can retry", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const context = new TraceContext({ id: "trace-1", name: "t" });
    context.recordTool({ name: "lookup" });

    await expect(
      lemma.ingest(context, { startedAt: new Date() }),
    ).rejects.toThrow("failed to ingest trace (503): nope");
    // A transport failure must not fabricate an error status on the trace.
    expect(jsonBody(fetchMock.mock.calls[0]).trace.status).toBeUndefined();
  });

  it("debug mode logs sanitized span summaries as spans arrive", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: "https://api.example.test/",
      fetch: fetchMock as typeof fetch,
    });

    enableDebugMode();
    try {
      await lemma.trace(
        { name: "support-agent", input: "secret trace input" },
        async (trace) => {
          trace.recordTool({
            name: "search_docs",
            input: { query: "secret query" },
            output: { status: "secret status" },
            durationMs: 25,
          });
          trace.recordGeneration({
            name: "draft-reply",
            input: "secret prompt",
            output: "secret answer",
            model: "gpt-test",
            durationMs: 40,
          });
          const liveSpanCalls = spy.mock.calls.filter(
            ([message]) => message === "[LEMMA:client] span recorded",
          );
          expect(liveSpanCalls).toHaveLength(2);
          expect(liveSpanCalls[0]?.[1]).toMatchObject({
            span: {
              name: "search_docs",
              type: "tool",
              durationMs: 25,
              hasInput: true,
              hasOutput: true,
              hasError: false,
            },
          });
          expect(liveSpanCalls[1]?.[1]).toMatchObject({
            span: {
              name: "draft-reply",
              type: "generation",
              durationMs: 40,
              model: "gpt-test",
              hasInput: true,
              hasOutput: true,
              hasError: false,
            },
          });
          expect(
            spy.mock.calls.some(
              ([message]) => message === "[LEMMA:client] sending trace",
            ),
          ).toBe(false);
          return "secret result";
        },
      );

      const sendingTraceCall = spy.mock.calls.find(
        ([message]) => message === "[LEMMA:client] sending trace",
      );
      expect(sendingTraceCall?.[1]).toMatchObject({
        name: "support-agent",
        spanCount: 2,
      });
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("secret query");
      expect(logged).not.toContain("secret prompt");
      expect(logged).not.toContain("secret answer");
      expect(logged).not.toContain("secret result");
    } finally {
      disableDebugMode();
      spy.mockRestore();
    }
  });

  it("debug mode logs live span handles when they start and end", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: "https://api.example.test/",
      fetch: fetchMock as typeof fetch,
    });

    enableDebugMode();
    try {
      await lemma.trace("support-agent", async (trace) => {
        const span = trace.startTool({
          name: "search_docs",
          input: { query: "secret query" },
        });
        expect(spy.mock.calls.at(-1)).toMatchObject([
          "[LEMMA:client] span started",
          {
            span: {
              id: span.id,
              name: "search_docs",
              type: "tool",
              hasInput: true,
              hasOutput: false,
              hasError: false,
            },
          },
        ]);

        span.end({ output: { status: "secret status" }, durationMs: 25 });
        expect(spy.mock.calls.at(-1)).toMatchObject([
          "[LEMMA:client] span ended",
          {
            span: {
              id: span.id,
              name: "search_docs",
              type: "tool",
              durationMs: 25,
              hasInput: true,
              hasOutput: true,
              hasError: false,
            },
          },
        ]);
        return "ok";
      });

      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("secret query");
      expect(logged).not.toContain("secret status");
    } finally {
      disableDebugMode();
      spy.mockRestore();
    }
  });

  it("logs init config once when debug mode is enabled", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();
    try {
      const lemma = new Lemma({
        apiKey: "sk_test_12345678",
        projectId: "10000000-0000-0000-0000-000000000001",
        baseUrl: "http://localhost:8000",
      });
      // Second construct on a different instance still logs (per-instance banner).
      new Lemma({
        apiKey: "sk_test_12345678",
        projectId: "10000000-0000-0000-0000-000000000001",
      });
      // Same instance does not re-log.
      (lemma as unknown as { logInitConfigOnce: () => void }).logInitConfigOnce();

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0]?.[1]).toMatchObject({
        baseUrl: "http://localhost:8000",
        projectId: "10000000-0000-0000-0000-000000000001",
        apiKey: "...5678",
        ingestPath: "/traces/ingest",
        expectedSuccessStatus: 201,
        warnings: expect.arrayContaining([
          "baseUrl is not production (https://api.uselemma.ai)",
        ]),
      });
    } finally {
      disableDebugMode();
      spy.mockRestore();
    }
  });

  it("logs ingest failure hints and response headers in debug mode", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();
    const fetchMock = vi.fn(async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "cf-ray": "ray-429", server: "cloudflare" },
      }),
    );
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    try {
      await expect(
        lemma.trace({ name: "support-agent" }, async () => "ok"),
      ).rejects.toThrow("failed to ingest trace (429)");

      const failedLog = spy.mock.calls.find((call) =>
        String(call[0]).includes("trace ingest failed"),
      );
      expect(failedLog?.[1]).toMatchObject({
        status: 429,
        hint: "ingest rate limit exceeded; retry with backoff",
        "cf-ray": "ray-429",
        server: "cloudflare",
        projectId: "10000000-0000-0000-0000-000000000001",
      });
    } finally {
      disableDebugMode();
      spy.mockRestore();
    }
  });

  it("debugSmokeTest returns structured delivery diagnostics", async () => {
    vi.useFakeTimers();
    let statusCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/traces/ingest-status")) {
        statusCalls += 1;
        // First poll is not_found so smoke waits and retries.
        const status = statusCalls === 1 ? "not_found" : "enqueued";
        return new Response(JSON.stringify({ status }), { status: 200 });
      }
      return new Response("{}", {
        status: 201,
        headers: { "cf-ray": "ray-smoke", server: "cloudflare" },
      });
    });
    const lemma = new Lemma({
      apiKey: "sk_test_12345678",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: "https://api.example.test",
      fetch: fetchMock as typeof fetch,
    });

    const pending = lemma.debugSmokeTest();
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.config).toMatchObject({
      baseUrl: "https://api.example.test",
      projectId: "10000000-0000-0000-0000-000000000001",
      apiKeySuffix: "...5678",
    });
    expect(result.ingest).toMatchObject({
      status: 201,
      projectId: "10000000-0000-0000-0000-000000000001",
      responseHeaders: { "cf-ray": "ray-smoke", server: "cloudflare" },
    });
    expect(result.ingestStatus).toBe("enqueued");
    expect(statusCalls).toBe(2);
    vi.useRealTimers();
  });

  it("debugSmokeTest is not ok when ingest-status check fails after ingest", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/traces/ingest-status")) {
        return new Response("nope", { status: 503 });
      }
      return new Response("{}", {
        status: 201,
        headers: { "cf-ray": "ray-smoke" },
      });
    });
    const lemma = new Lemma({
      apiKey: "sk_test_12345678",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const result = await lemma.debugSmokeTest();
    expect(result.ok).toBe(false);
    expect(result.hints).toEqual(
      expect.arrayContaining([
        "ingest-status check failed after ingest (status/network)",
      ]),
    );
  });

  it("LEMMA_DEBUG_VERIFY polls ingest-status only when debug mode is also on", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();
    process.env["LEMMA_DEBUG_VERIFY"] = "true";

    let statusCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/traces/ingest-status")) {
        statusCalls += 1;
        expect(href).toContain("otel_trace_id=");
        return new Response(JSON.stringify({ status: "enqueued" }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 201 });
    });
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    try {
      const pending = lemma.trace({ name: "verify-path" }, async () => "ok");
      await vi.runAllTimersAsync();
      await pending;
      expect(statusCalls).toBe(1);
      expect(
        spy.mock.calls.some((call) =>
          String(call[0]).includes("trace enqueued (status=enqueued)"),
        ),
      ).toBe(true);
    } finally {
      disableDebugMode();
      delete process.env["LEMMA_DEBUG_VERIFY"];
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("LEMMA_DEBUG_VERIFY retries ingest-status until timeout", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();
    process.env["LEMMA_DEBUG_VERIFY"] = "true";

    let statusCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/traces/ingest-status")) {
        statusCalls += 1;
        return new Response(JSON.stringify({ status: "not_found" }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 201 });
    });
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    try {
      const pending = lemma.trace({ name: "verify-timeout" }, async () => "ok");
      await vi.runAllTimersAsync();
      await pending;
      expect(statusCalls).toBeGreaterThan(1);
      expect(
        spy.mock.calls.some((call) =>
          String(call[0]).includes("ingest-status=not_found after 15s"),
        ),
      ).toBe(true);
    } finally {
      disableDebugMode();
      delete process.env["LEMMA_DEBUG_VERIFY"];
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("LEMMA_DEBUG_VERIFY alone does not poll ingest-status", async () => {
    process.env["LEMMA_DEBUG_VERIFY"] = "true";
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/traces/ingest-status")) {
        throw new Error("should not poll without debug mode");
      }
      return new Response("{}", { status: 201 });
    });
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    try {
      await lemma.trace({ name: "no-verify" }, async () => "ok");
      expect(
        fetchMock.mock.calls.every((call) => {
          const href =
            typeof call[0] === "string" ? call[0] : String(call[0]);
          return !href.includes("/traces/ingest-status");
        }),
      ).toBe(true);
    } finally {
      delete process.env["LEMMA_DEBUG_VERIFY"];
    }
  });
});
