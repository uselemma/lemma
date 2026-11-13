import { describe, expect, it } from "vitest";
import { readContentReply, textFromGenerationOutput } from "./reply-text";

describe("readContentReply", () => {
  it("joins output_text and text parts and skips reasoning", () => {
    expect(
      readContentReply([
        { type: "reasoning", encrypted_content: "gAAAA-secret-blob" },
        { type: "output_text", text: "It arrives Friday." },
        { type: "text", text: "Ships Friday." },
      ]),
    ).toEqual({
      parts: ["It arrives Friday.", "Ships Friday."],
      recognized: true,
    });
  });

  it("recognizes a reasoning-only list without reply text", () => {
    expect(
      readContentReply([{ type: "reasoning", text: "checking the shipment" }]),
    ).toEqual({ parts: [], recognized: true });
  });

  it("does not treat unrelated blocks as reply content", () => {
    expect(readContentReply([{ type: "tool-call", name: "lookup" }])).toEqual({
      parts: [],
      recognized: false,
    });
    expect(readContentReply("plain")).toBeUndefined();
  });

  it("flattens a generation list and skips encrypted reasoning", () => {
    expect(
      textFromGenerationOutput([
        { type: "reasoning", encrypted_content: "gAAAA-secret-blob" },
        {
          type: "message",
          content: [{ type: "output_text", text: "It arrives Friday." }],
        },
      ]),
    ).toBe("It arrives Friday.");
    expect(
      textFromGenerationOutput([
        { type: "reasoning", encrypted_content: "gAAAA-secret-blob" },
      ]),
    ).toBe("");
  });
});
