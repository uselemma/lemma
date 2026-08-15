import { describe, expect, it } from "vitest";
import { RELEASE_MAX_LENGTH, normalizeRelease } from "./release";

describe("normalizeRelease", () => {
  it("trims and keeps a valid release", () => {
    expect(normalizeRelease("  1.8.3  ")).toBe("1.8.3");
  });

  it("omits missing, empty, and whitespace-only values", () => {
    expect(normalizeRelease(undefined)).toBeUndefined();
    expect(normalizeRelease(null)).toBeUndefined();
    expect(normalizeRelease("")).toBeUndefined();
    expect(normalizeRelease("   ")).toBeUndefined();
    expect(normalizeRelease(12)).toBeUndefined();
  });

  it("keeps a 200-character release and drops a 201-character one", () => {
    const atCap = "a".repeat(RELEASE_MAX_LENGTH);
    const tooLong = "a".repeat(RELEASE_MAX_LENGTH + 1);
    expect(normalizeRelease(atCap)).toBe(atCap);
    expect(normalizeRelease(tooLong)).toBeUndefined();
  });

  it("drops releases that contain newlines, tabs, or carriage returns", () => {
    expect(normalizeRelease("v1\n2")).toBeUndefined();
    expect(normalizeRelease("v1\t2")).toBeUndefined();
    expect(normalizeRelease("v1\r2")).toBeUndefined();
  });
});
