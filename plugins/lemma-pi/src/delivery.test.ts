import { describe, expect, it, vi } from "vitest";

import { createDeliveryFetch } from "./delivery.js";

describe("Pi trace delivery", () => {
  it("bounds a request even when the fetch implementation ignores aborts", async () => {
    vi.useFakeTimers();
    const deliveryFetch = createDeliveryFetch(
      () => new Promise<Response>(() => undefined),
      10,
    );

    const request = expect(
      deliveryFetch("https://api.uselemma.ai/traces/ingest"),
    ).rejects.toThrow("delivery timed out");
    await vi.advanceTimersByTimeAsync(10);

    await request;
    vi.useRealTimers();
  });
});
