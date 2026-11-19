import { describe, expect, it, vi } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import { withPluginUserAgent } from "./user-agent.js";

const USER_AGENT = `${packageJson.name}/${packageJson.version}`;
const INGEST_URL = "https://api.uselemma.ai/traces/ingest";

async function sentHeaders(
  ...args: Parameters<typeof fetch>
): Promise<Headers> {
  const send = vi.fn<typeof fetch>(async () => new Response(null));
  await withPluginUserAgent(send)(...args);
  return new Headers(send.mock.calls[0]![1]!.headers);
}

describe("withPluginUserAgent", () => {
  it("keeps a Request's own headers and replaces its User-Agent", async () => {
    const headers = await sentHeaders(
      new Request(INGEST_URL, {
        headers: { "User-Agent": "other/1.0.0", "X-Lemma-Test": "kept" },
      }),
    );

    expect(headers.get("x-lemma-test")).toBe("kept");
    expect(headers.get("user-agent")).toBe(USER_AGENT);
  });

  it("lets init headers replace a Request's headers, as fetch does", async () => {
    const headers = await sentHeaders(
      new Request(INGEST_URL, { headers: { "X-Lemma-Test": "replaced" } }),
      { headers: { Authorization: "Bearer key" } },
    );

    expect(headers.get("x-lemma-test")).toBeNull();
    expect(headers.get("authorization")).toBe("Bearer key");
    expect(headers.get("user-agent")).toBe(USER_AGENT);
  });
});
