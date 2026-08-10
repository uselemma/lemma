import { describe, expect, it } from "vitest";
import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  it("returns null only when there is no error", () => {
    expect(errorMessage(null)).toBeNull();
    expect(errorMessage(undefined)).toBeNull();
    expect(errorMessage("   ")).toBeNull();
  });

  it("keeps plain Error messages unqualified", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("lookup failed")).toBe("lookup failed");
  });

  it("qualifies subclass errors with their class name", () => {
    expect(errorMessage(new TypeError("x is not a function"))).toBe(
      "TypeError: x is not a function",
    );

    class ToolTimeout extends Error {}
    expect(errorMessage(new ToolTimeout("timed out"))).toBe(
      "ToolTimeout: timed out",
    );
  });

  it("does not repeat a class name the message already carries", () => {
    const error = new TypeError("TypeError: already qualified");
    expect(errorMessage(error)).toBe("TypeError: already qualified");
  });

  it("never returns an empty message for a message-less error", () => {
    expect(errorMessage(new Error())).toBe("Error");
    expect(errorMessage(new RangeError())).toBe("RangeError");
    expect(errorMessage({ message: "" })).toBe("Error");
  });

  it("serializes non-Error objects instead of stringifying to [object Object]", () => {
    expect(errorMessage({ code: 502, detail: "upstream" })).toBe(
      '{"code":502,"detail":"upstream"}',
    );
    expect(errorMessage({ name: "HttpError", message: "bad gateway" })).toBe(
      "HttpError: bad gateway",
    );
  });

  it("falls back to a generic message for unserializable payloads", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errorMessage(circular)).toBe("Error");
    expect(errorMessage({})).toBe("Error");
  });
});
