import { describe, expect, it } from "vitest";
import {
  normalizeTokenUsage,
  toWireTokenUsage,
  tokenUsageAttributes,
} from "./usage";

describe("normalizeTokenUsage", () => {
  it("returns undefined for empty / total-only payloads", () => {
    expect(normalizeTokenUsage(undefined)).toBeUndefined();
    expect(normalizeTokenUsage(null)).toBeUndefined();
    expect(normalizeTokenUsage({})).toBeUndefined();
    expect(normalizeTokenUsage({ totalTokens: 12 })).toBeUndefined();
    expect(normalizeTokenUsage({ total_tokens: 12 })).toBeUndefined();
  });

  it("accepts camelCase and snake_case input/output", () => {
    expect(
      normalizeTokenUsage({ inputTokens: 10, outputTokens: 4 }),
    ).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(
      normalizeTokenUsage({ input_tokens: 10, output_tokens: 4 }),
    ).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it("accepts prompt/completion aliases", () => {
    expect(
      normalizeTokenUsage({ promptTokens: 3, completionTokens: 1 }),
    ).toEqual({ inputTokens: 3, outputTokens: 1 });
    expect(
      normalizeTokenUsage({ prompt_tokens: 3, completion_tokens: 1 }),
    ).toEqual({ inputTokens: 3, outputTokens: 1 });
  });

  it("maps OpenAI nested cached and reasoning details", () => {
    expect(
      normalizeTokenUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 40 },
        completion_tokens_details: { reasoning_tokens: 12 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 40,
      reasoningOutputTokens: 12,
    });
  });

  it("maps OpenAI Agents / Responses input_tokens_details shapes", () => {
    expect(
      normalizeTokenUsage({
        input_tokens: 100,
        output_tokens: 50,
        input_tokens_details: {
          cached_tokens: 40,
          cache_write_tokens: 8,
        },
        output_tokens_details: { reasoning_tokens: 12 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 8,
      reasoningOutputTokens: 12,
    });
  });

  it("maps Anthropic-style cache fields", () => {
    expect(
      normalizeTokenUsage({
        input_tokens: 80,
        output_tokens: 20,
        cache_read_input_tokens: 60,
        cache_creation_input_tokens: 5,
      }),
    ).toEqual({
      inputTokens: 80,
      outputTokens: 20,
      cacheReadInputTokens: 60,
      cacheCreationInputTokens: 5,
    });
  });

  it("maps Vercel AI cachedInputTokens / reasoningTokens", () => {
    expect(
      normalizeTokenUsage({
        inputTokens: 11,
        outputTokens: 2,
        cachedInputTokens: 7,
        reasoningTokens: 1,
      }),
    ).toEqual({
      inputTokens: 11,
      outputTokens: 2,
      cacheReadInputTokens: 7,
      reasoningOutputTokens: 1,
    });
  });

  it("maps AI SDK 7 inputTokenDetails / outputTokenDetails", () => {
    expect(
      normalizeTokenUsage({
        inputTokens: 20,
        outputTokens: 6,
        inputTokenDetails: {
          noCacheTokens: 10,
          cacheReadTokens: 7,
          cacheWriteTokens: 3,
        },
        outputTokenDetails: {
          textTokens: 4,
          reasoningTokens: 2,
        },
      }),
    ).toEqual({
      inputTokens: 20,
      outputTokens: 6,
      cacheReadInputTokens: 7,
      cacheCreationInputTokens: 3,
      reasoningOutputTokens: 2,
    });
  });

  it("unwraps LangChain tokenUsage / usage_metadata nests", () => {
    expect(
      normalizeTokenUsage({
        tokenUsage: { promptTokens: 9, completionTokens: 3 },
      }),
    ).toEqual({ inputTokens: 9, outputTokens: 3 });
    expect(
      normalizeTokenUsage({
        usage_metadata: { input_tokens: 9, output_tokens: 3 },
      }),
    ).toEqual({ inputTokens: 9, outputTokens: 3 });
  });

  it("preserves explicit zeros", () => {
    expect(
      normalizeTokenUsage({ inputTokens: 0, outputTokens: 0 }),
    ).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("toWireTokenUsage / tokenUsageAttributes", () => {
  it("converts to snake_case wire format and GenAI attributes", () => {
    const usage = {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadInputTokens: 3,
      cacheCreationInputTokens: 4,
      reasoningOutputTokens: 5,
    };
    expect(toWireTokenUsage(usage)).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 4,
      reasoning_output_tokens: 5,
    });
    expect(tokenUsageAttributes(usage)).toEqual({
      "gen_ai.usage.input_tokens": 1,
      "llm.token_count.prompt": 1,
      "gen_ai.usage.output_tokens": 2,
      "llm.token_count.completion": 2,
      "gen_ai.usage.cache_read.input_tokens": 3,
      "gen_ai.usage.cache_creation.input_tokens": 4,
      "gen_ai.usage.reasoning.output_tokens": 5,
    });
  });

  it("omits undefined wire fields", () => {
    expect(toWireTokenUsage({ inputTokens: 1 })).toEqual({
      input_tokens: 1,
    });
    expect(toWireTokenUsage(undefined)).toBeUndefined();
  });
});
