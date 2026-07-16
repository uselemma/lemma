import { describe, expect, it } from "vitest";
import { toolResultError } from "./tool-result";

describe("toolResultError", () => {
  it("returns null for successful payloads", () => {
    expect(toolResultError({ content: [{ text: "ok", type: "text" }] })).toBeNull();
    expect(toolResultError({ isError: false, content: [] })).toBeNull();
    expect(toolResultError("plain text")).toBeNull();
  });

  it("extracts MCP isError content text", () => {
    expect(
      toolResultError({
        isError: true,
        content: [
          {
            type: "text",
            text: "Internal error: Validation error",
          },
        ],
      }),
    ).toBe("Internal error: Validation error");
  });

  it("parses JSON string tool payloads", () => {
    expect(
      toolResultError(
        JSON.stringify({
          isError: true,
          content: [{ type: "text", text: "boom" }],
        }),
      ),
    ).toBe("boom");
  });
});
