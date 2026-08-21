import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeliveryFetch } from "./delivery.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenCode trace delivery", () => {
  it("bounds response body reads after headers arrive", async () => {
    vi.useFakeTimers();
    const deliveryFetch = createDeliveryFetch(
      async () =>
        new Response(
          new ReadableStream({
            start() {
              return undefined;
            },
          }),
          { status: 500 },
        ),
      10,
    );

    const request = expect(
      deliveryFetch("https://api.uselemma.ai/traces/ingest"),
    ).rejects.toThrow("delivery timed out");
    await vi.advanceTimersByTimeAsync(10);

    await request;
  });
});
