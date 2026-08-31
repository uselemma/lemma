import { describe, expect, it } from "vitest";
import {
  pickGenerationModelIdentity,
  pickModelIdentity,
} from "./model";

describe("pickModelIdentity", () => {
  it("returns undefined for empty payloads and bare strings", () => {
    expect(pickModelIdentity(undefined)).toBeUndefined();
    expect(pickModelIdentity(null)).toBeUndefined();
    expect(pickModelIdentity({})).toBeUndefined();
    expect(pickModelIdentity("")).toBeUndefined();
    expect(pickModelIdentity("   ")).toBeUndefined();
    expect(pickModelIdentity("gpt-4o")).toBeUndefined();
    expect(pickModelIdentity("It arrives Friday.")).toBeUndefined();
  });

  it("reads model aliases including ls_model_name", () => {
    expect(pickModelIdentity({ model: "gpt-4o" })).toBe("gpt-4o");
    expect(pickModelIdentity({ model_name: "gpt-4o-mini" })).toBe("gpt-4o-mini");
    expect(pickModelIdentity({ modelName: "claude-3" })).toBe("claude-3");
    expect(pickModelIdentity({ model_id: "o3" })).toBe("o3");
    expect(pickModelIdentity({ modelId: "gpt-4.1" })).toBe("gpt-4.1");
    expect(pickModelIdentity({ ls_model_name: "gpt-4o" })).toBe("gpt-4o");
  });

  it("reads nested response_metadata and model objects", () => {
    expect(
      pickModelIdentity({
        response_metadata: { model_name: "gpt-4o-mini" },
      }),
    ).toBe("gpt-4o-mini");
    expect(
      pickModelIdentity({
        model: { modelId: "gpt-4o", provider: "openai" },
      }),
    ).toBe("gpt-4o");
  });

  it("does not treat message/response/text strings as a model id", () => {
    expect(pickModelIdentity({ message: "hello" })).toBeUndefined();
    expect(pickModelIdentity({ response: "hello" })).toBeUndefined();
    expect(pickModelIdentity({ text: "It arrives Friday." })).toBeUndefined();
    expect(
      pickModelIdentity({ role: "assistant", content: "hello" }),
    ).toBeUndefined();
  });
});

describe("pickGenerationModelIdentity", () => {
  it("walks LangChain LLMResult generations for response_metadata.model_name", () => {
    expect(
      pickGenerationModelIdentity({
        generations: [
          [
            {
              text: "hello",
              message: {
                content: "hello",
                type: "ai",
                response_metadata: { model_name: "gpt-4o-mini" },
              },
            },
          ],
        ],
      }),
    ).toBe("gpt-4o-mini");
  });

  it("prefers a top-level model over nested generation metadata", () => {
    expect(
      pickGenerationModelIdentity({
        model: "gpt-4o",
        generations: [
          [{ message: { response_metadata: { model_name: "other" } } }],
        ],
      }),
    ).toBe("gpt-4o");
  });

  it("does not treat generation text or string messages as a model id", () => {
    expect(
      pickGenerationModelIdentity({
        generations: [[{ text: "It arrives Friday.", message: "hello" }]],
      }),
    ).toBeUndefined();
  });
});
