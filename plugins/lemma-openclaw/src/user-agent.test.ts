import { readFileSync } from "node:fs";

import { SDK_USER_AGENT } from "../../../packages/ts/tracing/src/client.js";
import { describe, expect, it, vi } from "vitest";

import { createDeliveryFetch } from "./delivery.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

describe("OpenClaw User-Agent", () => {
  it("replaces the tracing SDK's User-Agent on trace delivery", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 201 }),
    );

    await createDeliveryFetch(fetchMock)(
      "https://api.example.test/traces/ingest",
      {
        headers: { "User-Agent": SDK_USER_AGENT, Authorization: "Bearer key" },
      },
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("user-agent")).toBe(
      `${packageJson.name}/${packageJson.version}`,
    );
    expect(headers.get("authorization")).toBe("Bearer key");
  });
});
