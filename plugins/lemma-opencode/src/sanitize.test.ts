import { describe, expect, it } from "vitest";

import { sanitizeText, sanitizeValue } from "./sanitize.js";

describe("OpenCode sanitization", () => {
  it("redacts common authorization, environment, provider, and PEM secrets", () => {
    const value = sanitizeText(
      [
        "Authorization: Basic dXNlcjpwYXNz",
        "Cookie: session=first-secret; csrf=second-secret",
        "Set-Cookie: session=third-secret; HttpOnly; Secure",
        '{"Set-Cookie":["fourth-secret","fifth-secret"],"Content-Type":"text/plain"}',
        "bearer private-token-1234",
        "AWS_SECRET_ACCESS_KEY=super-secret",
        "OPENAI_API_KEY=sk-1234567890abcdefghijklmnop",
        "DATABASE_URL=postgresql://alice:hunter2@db.example.com/app",
        "STRIPE_SECRET_KEY=sk_live_1234567890abcdefghijkl",
        "github_pat_1234567890abcdefghijklmnop",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signaturevalue",
        "https://user:password@example.com/private",
        "redis://cache-user:cache-password@cache.example.com/0",
        "-----BEGIN PRIVATE KEY-----",
        "private-material",
        "-----END PRIVATE KEY-----",
      ].join("\n"),
    );

    expect(value.split("\n")[0]).toBe("Authorization: [REDACTED]");
    expect(value).toContain("Cookie: [REDACTED]");
    expect(value).toContain("Set-Cookie: [REDACTED]");
    expect(value).toContain(
      '{"Set-Cookie":"[REDACTED]","Content-Type":"text/plain"}',
    );
    expect(value).toContain("AWS_SECRET_ACCESS_KEY=[REDACTED]");
    expect(value).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(value).toContain("DATABASE_URL=[REDACTED]");
    expect(value).toContain("STRIPE_SECRET_KEY=[REDACTED]");
    expect(value).toContain("[TOKEN REDACTED]");
    expect(value).toContain("https://[REDACTED]@example.com/private");
    expect(value).toContain("redis://[REDACTED]@cache.example.com/0");
    expect(value).toContain("[PEM REDACTED]");
    expect(value).not.toContain("dXNlcjpwYXNz");
    expect(value).not.toContain("first-secret");
    expect(value).not.toContain("second-secret");
    expect(value).not.toContain("third-secret");
    expect(value).not.toContain("fourth-secret");
    expect(value).not.toContain("fifth-secret");
    expect(value).not.toContain("db.example.com");
    expect(value).not.toContain("private-token-1234");
    expect(value).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(value).not.toContain("private-material");
  });

  it("preserves ordinary authentication prose", () => {
    expect(
      sanitizeText("Explain basic authentication and negotiate headers."),
    ).toBe("Explain basic authentication and negotiate headers.");
  });

  it("drops structured secret-bearing keys", () => {
    expect(
      sanitizeValue({
        command: "pnpm test",
        awsSecretAccessKey: "secret",
        privateKey: "private",
        nested: { credential: "credential", result: "passed" },
        token_count: 4,
      }),
    ).toEqual({
      command: "pnpm test",
      nested: { result: "passed" },
      token_count: 4,
    });
  });
});
