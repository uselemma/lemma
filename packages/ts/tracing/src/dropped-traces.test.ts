import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureWarnings } from "../test-helpers";
import { DROPPED_TRACE_WARNING_WINDOW_MS } from "./debug-delivery";
import { disableDebugMode, enableDebugMode } from "./debug-mode";
import {
  flushDroppedTraceWarnings,
  reportDroppedTrace,
} from "./dropped-traces";

function drop(traceId: string, reason = "ingest returned 503") {
  reportDroppedTrace({ traceId, attempts: 3, reason });
}

describe("dropped-trace warnings", () => {
  let warn: ReturnType<typeof captureWarnings>;

  beforeEach(() => {
    vi.useFakeTimers();
    warn = captureWarnings();
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  it("warns once, with the trace ID, on the first drop", () => {
    drop("trace-1");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe(
      "@uselemma/tracing: dropped trace trace-1 after 3 attempts: ingest returned 503. Further drops are counted and reported every 60s; set LEMMA_DEBUG=1 to log each one.",
    );
  });

  it("writes no extra lines for a burst inside the window", () => {
    drop("trace-1");
    for (let i = 2; i <= 50; i += 1) drop(`trace-${i}`);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reports the window's count at its end", () => {
    drop("trace-1");
    drop("trace-2");
    drop("trace-3", "ingest request timed out after 10000ms");

    vi.advanceTimersByTime(DROPPED_TRACE_WARNING_WINDOW_MS);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toBe(
      "@uselemma/tracing: dropped 2 more traces in the last 60s; latest: ingest request timed out after 10000ms. Set LEMMA_DEBUG=1 to log each one.",
    );
  });

  it("counts drops left pending when the window expired before its timer ran", () => {
    drop("trace-1");
    drop("trace-2");
    vi.setSystemTime(Date.now() + DROPPED_TRACE_WARNING_WINDOW_MS);
    drop("trace-3");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toContain("dropped 2 more traces");
  });

  it("warns with the trace ID again after a quiet window", () => {
    drop("trace-1");
    vi.advanceTimersByTime(DROPPED_TRACE_WARNING_WINDOW_MS);
    drop("trace-2");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toContain("dropped trace trace-2 after");
  });

  it("logs every drop in debug mode", () => {
    enableDebugMode();
    try {
      drop("trace-1");
      drop("trace-2");
      drop("trace-3");
    } finally {
      disableDebugMode();
    }

    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      "@uselemma/tracing: dropped trace trace-1 after 3 attempts: ingest returned 503.",
      "@uselemma/tracing: dropped trace trace-2 after 3 attempts: ingest returned 503.",
      "@uselemma/tracing: dropped trace trace-3 after 3 attempts: ingest returned 503.",
    ]);
  });

  it("prints the pending count once when the process exits", () => {
    drop("trace-1");
    drop("trace-2");
    drop("trace-3");
    vi.advanceTimersByTime(20_000);

    const exitListeners = process
      .listeners("exit")
      .filter((listener) => listener === flushDroppedTraceWarnings);
    expect(exitListeners).toHaveLength(1);
    exitListeners[0]?.(0);
    flushDroppedTraceWarnings();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toBe(
      "@uselemma/tracing: dropped 2 more traces in the last 20s; latest: ingest returned 503. Set LEMMA_DEBUG=1 to log each one.",
    );
  });
});
