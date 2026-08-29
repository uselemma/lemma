import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGitHubReviewClient } from "./github-review-api";

describe("createGitHubReviewClient", () => {
  it("creates commit statuses without calling the pull request API", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGitHubReviewClient({
      token: "github-token",
      repository: "uselemma/platform",
      prNumber: 42,
      marker: "<!-- test-review -->",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json({});
      },
    });

    await client.createCommitStatus({
      sha: "abc123",
      state: "pending",
      targetUrl: "https://cursor.test/agent-1",
      description: "Review running",
      context: "Thermo-Nuclear Review",
    });

    assert.equal(
      requests[0]?.url,
      "https://api.github.com/repos/uselemma/platform/statuses/abc123",
    );
    assert.equal(requests[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      state: "pending",
      target_url: "https://cursor.test/agent-1",
      description: "Review running",
      context: "Thermo-Nuclear Review",
    });
    assert.doesNotMatch(requests[0]?.url ?? "", /\/pulls/);
  });

  it("uses the caller-provided marker when upserting comments", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const marker = "<!-- custom-review -->";
    const client = createGitHubReviewClient({
      token: "github-token",
      repository: "uselemma/platform",
      prNumber: 42,
      marker,
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return init?.method === "POST" ? Response.json({}) : Response.json([]);
      },
    });

    await client.upsertComment(`${marker}\n## Review`);

    assert.equal(requests.length, 2);
    assert.match(requests[0]?.url ?? "", /issues\/42\/comments/);
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
      body: `${marker}\n## Review`,
    });
  });

  it("does not patch another author's marked comment", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const marker = "<!-- custom-review -->";
    const client = createGitHubReviewClient({
      token: "github-token",
      repository: "uselemma/platform",
      prNumber: 42,
      marker,
      commentAuthor: "lemma-code-review-publisher[bot]",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        if (init?.method === "POST") return Response.json({ id: 9 });
        return Response.json([
          {
            id: 7,
            body: `${marker}\nCole's old checklist`,
            user: { login: "chroline" },
          },
        ]);
      },
    });

    await client.upsertComment(`${marker}\n## Review`);

    assert.equal(requests[0]?.init?.method, undefined);
    assert.equal(requests[1]?.init?.method, "POST");
    assert.doesNotMatch(requests[1]?.url ?? "", /comments\/7/);
  });

  it("patches only the publisher bot's marked comment", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const marker = "<!-- custom-review -->";
    const client = createGitHubReviewClient({
      token: "github-token",
      repository: "uselemma/platform",
      prNumber: 42,
      marker,
      commentAuthor: "lemma-code-review-publisher[bot]",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        if (init?.method === "PATCH") return Response.json({ id: 8 });
        return Response.json([
          {
            id: 7,
            body: `${marker}\nCole's old checklist`,
            user: { login: "chroline" },
          },
          {
            id: 8,
            body: `${marker}\nBot checklist`,
            user: { login: "lemma-code-review-publisher[bot]" },
          },
        ]);
      },
    });

    await client.upsertComment(`${marker}\n## Review`);

    assert.equal(requests[1]?.init?.method, "PATCH");
    assert.match(requests[1]?.url ?? "", /issues\/comments\/8/);
  });

  it("posts a running comment when only another author owns the marker", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const marker = "<!-- custom-review -->";
    const client = createGitHubReviewClient({
      token: "github-token",
      repository: "uselemma/platform",
      prNumber: 42,
      marker,
      commentAuthor: "lemma-code-review-publisher[bot]",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        if (init?.method === "POST") return Response.json({ id: 9 });
        return Response.json([
          {
            id: 7,
            body: `${marker}\nCole's old checklist`,
            user: { login: "chroline" },
          },
        ]);
      },
    });

    await client.ensureComment(`${marker}\nReview running`);

    assert.equal(requests[1]?.init?.method, "POST");
  });

  it("does not replace an existing marked comment when ensuring one exists", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const marker = "<!-- custom-review -->";
    const client = createGitHubReviewClient({
      token: "github-token",
      repository: "uselemma/platform",
      prNumber: 42,
      marker,
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json([{ id: 7, body: `${marker}\n- [ ] finding` }]);
      },
    });

    await client.ensureComment(`${marker}\nReview running`);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.init?.method, undefined);
  });
});
