import { describe, expect, it } from "vitest";
import { describeError, errorMessage, failureMessage } from "./error-message";

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

  it("tolerates errors whose message or name is not a string", () => {
    // A subclass that redeclares `message` as a class field gets an own
    // `message` of undefined, shadowing Error.prototype.message.
    class ApiError extends Error {}
    const shadowed = new ApiError("upstream failed");
    Object.defineProperty(shadowed, "message", { value: undefined });
    expect(errorMessage(shadowed)).toBe("ApiError");

    const payloadMessage = Object.assign(new TypeError("x"), { message: 42 });
    expect(errorMessage(payloadMessage)).toBe("TypeError: 42");

    const oddName = Object.assign(new Error("boom"), { name: { odd: true } });
    expect(errorMessage(oddName)).toBe("boom");
  });

  it("tolerates payloads that refuse to stringify", () => {
    const hostileToString = {
      toString() {
        throw new Error("nope");
      },
    };
    expect(errorMessage(hostileToString)).toBe("Error");

    const hostilePrimitive = {
      [Symbol.toPrimitive]() {
        throw new Error("nope");
      },
    };
    expect(describeError(hostilePrimitive)).toBe("Error");
  });
});

describe("failureMessage", () => {
  it("reports no failure only for nullish values", () => {
    expect(failureMessage(null)).toBeNull();
    expect(failureMessage(undefined)).toBeNull();
  });

  it("keeps a failure whose value carries no readable message", () => {
    expect(failureMessage("   ")).toBe("Error");
    expect(failureMessage({})).toBe("Error");
    expect(failureMessage(new Error())).toBe("Error");
  });
});
