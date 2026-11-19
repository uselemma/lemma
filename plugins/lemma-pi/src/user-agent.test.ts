import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createDeliveryFetch } from "./delivery.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

describe("Pi User-Agent", () => {
  it("replaces the tracing SDK's User-Agent on trace delivery", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 201 }),
    );

    await createDeliveryFetch(fetchMock)(
      "https://api.example.test/traces/ingest",
      {
        headers: {
          "User-Agent": "@uselemma/tracing/7.13.1",
          Authorization: "Bearer key",
        },
      },
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("user-agent")).toBe(
      `${packageJson.name}/${packageJson.version}`,
    );
    expect(headers.get("authorization")).toBe("Bearer key");
  });
});
