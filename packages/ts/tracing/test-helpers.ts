import { vi } from "vitest";

export const LEMMA_PROJECT_ID = "10000000-0000-0000-0000-000000000001";

export function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

export function ingestFetchMock() {
  return vi.fn(async () => new Response("{}", { status: 201 }));
}

/**
 * Run `run` on fake timers until no timer is left, so retry backoff and
 * request timeouts complete without real waiting.
 */
export async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const pending = run();
    // Observed now so a rejection is not reported as unhandled while timers run.
    pending.catch(() => {});
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

/** Silence and capture the SDK's console warnings for one test. */
export function captureWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}
