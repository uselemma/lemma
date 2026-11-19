import { describe, expect, it, vi } from "vitest";
import { captureWarnings, withFakeTimers } from "../test-helpers";
import { Lemma, TraceContext } from "./client";
import { disableDebugMode, enableDebugMode } from "./debug-mode";
import { INGEST_MAX_ATTEMPTS, INGEST_REQUEST_TIMEOUT_MS } from "./delivery";

describe("automatic trace delivery", () => {
  function lemmaWith(fetchMock: unknown) {
    return new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });
  }

  it("delivers after a transient 5xx and a network error, resending the same payload", async () => {
    const warn = captureWarnings();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response("{}", { status: 201 }));
    const lemma = lemmaWith(fetchMock);

    await expect(
      withFakeTimers(() => lemma.trace("support-agent", async () => "ok")),
    ).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit).body,
    );
    expect(new Set(bodies).size).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once when every attempt fails", async () => {
    const warn = captureWarnings();
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    const trace = lemmaWith(fetchMock).trace({
      id: "trace-1",
      name: "support-agent",
    });

    await withFakeTimers(() => trace.end({ output: "ok" }));

    expect(fetchMock).toHaveBeenCalledTimes(INGEST_MAX_ATTEMPTS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(
      `@uselemma/tracing: dropped trace trace-1 after ${INGEST_MAX_ATTEMPTS} attempts: ingest returned 503. Drops in the next 60s are counted, not logged; set LEMMA_DEBUG=1 to log each one.`,
    );
  });

  it("does not retry a rejected request, and names the fix", async () => {
    const warn = captureWarnings();
    const fetchMock = vi.fn(
      async () => new Response("bad key", { status: 401 }),
    );
    const trace = lemmaWith(fetchMock).trace({
      id: "trace-1",
      name: "support-agent",
    });

    await withFakeTimers(() => trace.end({ output: "ok" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(
      "@uselemma/tracing: dropped trace trace-1 after 1 attempt: ingest returned 401 (check LEMMA_API_KEY). Drops in the next 60s are counted, not logged; set LEMMA_DEBUG=1 to log each one.",
    );
  });

  it("times out a stalled send and retries it, even when fetch ignores the abort", async () => {
    const warn = captureWarnings();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return signals.length === 1
        ? new Promise<Response>(() => {})
        : Promise.resolve(new Response("{}", { status: 201 }));
    });
    const lemma = lemmaWith(fetchMock);

    await expect(
      withFakeTimers(() => lemma.trace("support-agent", async () => "ok")),
    ).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("waits out a 429 Retry-After before resending", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )
      .mockResolvedValue(new Response("{}", { status: 201 }));
    const lemma = lemmaWith(fetchMock);

    vi.useFakeTimers();
    try {
      const pending = lemma.trace("support-agent", async () => "ok");
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(pending).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns when the payload cannot be built, without sending", async () => {
    const warn = captureWarnings();
    vi.spyOn(TraceContext.prototype, "toPayload").mockImplementation(() => {
      throw new Error("unserializable output");
    });
    const fetchMock = vi.fn();
    const trace = lemmaWith(fetchMock).trace({
      id: "trace-1",
      name: "support-agent",
    });

    await trace.end({ output: "ok" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toBe(
      "@uselemma/tracing: dropped trace trace-1 before sending: unserializable output. Drops in the next 60s are counted, not logged; set LEMMA_DEBUG=1 to log each one.",
    );
  });

  it("does not report a delivered trace as dropped when the verify poll fails", async () => {
    const warn = captureWarnings();
    vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();
    process.env["LEMMA_DEBUG_VERIFY"] = "1";
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/traces/ingest-status")) {
        throw new TypeError("fetch failed");
      }
      return new Response("{}", { status: 201 });
    });

    try {
      await expect(
        lemmaWith(fetchMock).trace("support-agent", async () => "ok"),
      ).resolves.toBe("ok");
    } finally {
      delete process.env["LEMMA_DEBUG_VERIFY"];
      disableDebugMode();
    }

    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a failing post-send check out of the caller and the drop warnings", async () => {
    const warn = captureWarnings();
    vi.spyOn(
      Lemma.prototype as unknown as { afterTraceSent: () => Promise<void> },
      "afterTraceSent",
    ).mockRejectedValue(new Error("check broke"));
    const lemma = lemmaWith(
      vi.fn(async () => new Response("{}", { status: 201 })),
    );

    await expect(
      lemma.trace({ id: "trace-1", name: "support-agent" }).end(),
    ).resolves.toBeUndefined();
    await expect(
      lemma.ingest(new TraceContext({ id: "trace-2", name: "t" }), {
        startedAt: new Date(),
      }),
    ).resolves.toBeUndefined();

    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      "@uselemma/tracing: trace trace-1 was delivered, but its post-send check failed: check broke",
      "@uselemma/tracing: trace trace-2 was delivered, but its post-send check failed: check broke",
    ]);
  });

  it("logs a payload that cannot be built in debug mode", async () => {
    captureWarnings();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(TraceContext.prototype, "toPayload").mockImplementation(() => {
      throw new Error("unserializable output");
    });
    enableDebugMode();
    try {
      await lemmaWith(vi.fn()).trace({ id: "trace-1", name: "agent" }).end();
    } finally {
      disableDebugMode();
    }

    const failed = log.mock.calls.find((call) =>
      String(call[0]).includes("trace ingest failed"),
    );
    expect(failed?.[1]).toMatchObject({
      traceId: "trace-1",
      error: "unserializable output",
    });
  });

  it("ingest() sends once and throws when the send times out", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const lemma = lemmaWith(fetchMock);
    const context = new TraceContext({ id: "trace-1", name: "t" });

    await expect(
      withFakeTimers(() => lemma.ingest(context, { startedAt: new Date() })),
    ).rejects.toThrow(
      `ingest request timed out after ${INGEST_REQUEST_TIMEOUT_MS}ms`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
