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

  it("extracts Mastra ValidationError message from error: true payloads", () => {
    expect(
      toolResultError({
        error: true,
        message: "Tool input validation failed for ship",
        validationErrors: { errors: [], fields: {} },
      }),
    ).toBe("Tool input validation failed for ship");
    expect(toolResultError({ error: false, message: "ignored" })).toBeNull();
  });

  it("treats a string error field as a tool failure", () => {
    expect(
      toolResultError({ error: "Error: Payment method not found" }),
    ).toBe("Error: Payment method not found");
    expect(toolResultError({ error: "" })).toBeNull();
    expect(toolResultError({ error: null })).toBeNull();
  });

  it("treats MCP isError:false payloads with structuredContent.error as failures", () => {
    expect(
      toolResultError({
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Error: Payment method not found",
            }),
          },
        ],
        structuredContent: { error: "Error: Payment method not found" },
      }),
    ).toBe("Error: Payment method not found");
  });

  it("parses an error object out of MCP content text when isError is false", () => {
    expect(
      toolResultError({
        isError: false,
        content: [
          {
            type: "text",
            text: '{"error":"Error: Payment method should be the original payment method"}',
          },
        ],
      }),
    ).toBe("Error: Payment method should be the original payment method");
  });
});
