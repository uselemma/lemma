import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCursorAgentClient } from "./cursor-agent-api";

describe("createCursorAgentClient", () => {
  it("uses the v1 endpoint and bearer authentication", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const client = createCursorAgentClient({
      apiKey: "cursor-secret",
      fetchImpl: async (input, init) => {
        requests.push({ input: String(input), init });
        return Response.json({
          agent: { id: "agent-1", name: "review", url: "https://cursor.test" },
          run: { id: "run-1", agentId: "agent-1", status: "CREATING" },
        });
      },
    });

    await client.createAgent({
      name: "Review",
      prompt: { text: "Review the PR" },
      repos: [{ url: "https://github.com/uselemma/platform" }],
    });

    assert.equal(requests[0]?.input, "https://api.cursor.com/v1/agents");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal(
      new Headers(requests[0]?.init?.headers).get("Authorization"),
      "Bearer cursor-secret",
    );
  });
});
