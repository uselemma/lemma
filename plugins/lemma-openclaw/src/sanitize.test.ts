import { describe, expect, it } from "vitest";

import { lastAssistantText, sanitizeValue } from "./sanitize.js";

describe("OpenClaw sanitization", () => {
  it("removes secret-bearing fields recursively", () => {
    expect(
      sanitizeValue({
        command: "deploy",
        authorization: "Bearer secret",
        nested: {
          apiKey: "secret",
          result: "ok",
        },
      }),
    ).toEqual({ command: "deploy", nested: { result: "ok" } });
  });

  it("extracts the last assistant text response", () => {
    expect(
      lastAssistantText([
        { role: "assistant", content: "first" },
        { role: "user", content: "continue" },
        {
          role: "assistant",
          content: [{ type: "text", text: "finished" }],
        },
      ]),
    ).toBe("finished");
  });

  it("redacts credentials embedded in captured strings", () => {
    expect(
      sanitizeValue(
        'authorization: Bearer private-token access_token="private-access" password=hunter2',
      ),
    ).toBe(
      "authorization: [REDACTED] access_token=[REDACTED] password=[REDACTED]",
    );
    expect(sanitizeValue("request used Bearer private-token")).toBe(
      "request used Bearer [REDACTED]",
    );
  });
});
