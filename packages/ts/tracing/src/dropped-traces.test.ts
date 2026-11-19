import { describe, expect, it, vi } from "vitest";
import { captureWarnings } from "../test-helpers";
import { disableDebugMode, enableDebugMode } from "./debug-mode";
import {
  DROPPED_TRACE_WARNING_WINDOW_MS,
  reportDroppedTrace,
} from "./dropped-traces";

const CAUSE = "after 3 attempts: ingest returned 503";
const NEXT =
  "Drops in the next 60s are counted, not logged; set LEMMA_DEBUG=1 to log each one.";

function drop(traceId: string) {
  reportDroppedTrace(traceId, CAUSE);
}

describe("dropped-trace warnings", () => {
  it("warns once, with the trace ID, on the first drop", () => {
    const warn = captureWarnings();
    drop("trace-1");

    expect(warn.mock.calls).toEqual([
      [`@uselemma/tracing: dropped trace trace-1 ${CAUSE}. ${NEXT}`],
    ]);
  });

  it("counts drops inside the window without writing lines", () => {
    vi.useFakeTimers();
    const warn = captureWarnings();
    drop("trace-1");
    for (let i = 2; i <= 50; i += 1) {
      vi.advanceTimersByTime(1_000);
      drop(`trace-${i}`);
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reports the count on the first drop after the window", () => {
    vi.useFakeTimers();
    const warn = captureWarnings();
    drop("trace-1");
    drop("trace-2");
    drop("trace-3");
    vi.advanceTimersByTime(DROPPED_TRACE_WARNING_WINDOW_MS);
    drop("trace-4");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toBe(
      `@uselemma/tracing: dropped trace trace-4 ${CAUSE}. 2 more dropped since the last warning. ${NEXT}`,
    );
  });

  it("starts a new window and count at each warning", () => {
    vi.useFakeTimers();
    const warn = captureWarnings();
    drop("trace-1");
    drop("trace-2");
    vi.advanceTimersByTime(DROPPED_TRACE_WARNING_WINDOW_MS);
    drop("trace-3");
    vi.advanceTimersByTime(DROPPED_TRACE_WARNING_WINDOW_MS - 1);
    drop("trace-4");
    vi.advanceTimersByTime(1);
    drop("trace-5");

    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      `@uselemma/tracing: dropped trace trace-1 ${CAUSE}. ${NEXT}`,
      `@uselemma/tracing: dropped trace trace-3 ${CAUSE}. 1 more dropped since the last warning. ${NEXT}`,
      `@uselemma/tracing: dropped trace trace-5 ${CAUSE}. 1 more dropped since the last warning. ${NEXT}`,
    ]);
  });

  it("logs every drop in debug mode", () => {
    const warn = captureWarnings();
    enableDebugMode();
    try {
      drop("trace-1");
      drop("trace-2");
      drop("trace-3");
    } finally {
      disableDebugMode();
    }

    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      `@uselemma/tracing: dropped trace trace-1 ${CAUSE}.`,
      `@uselemma/tracing: dropped trace trace-2 ${CAUSE}.`,
      `@uselemma/tracing: dropped trace trace-3 ${CAUSE}.`,
    ]);
  });
});
