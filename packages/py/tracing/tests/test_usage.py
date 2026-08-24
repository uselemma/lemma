from uselemma_tracing.usage import normalize_token_usage, token_usage_attributes


def test_normalize_omits_total_only_and_empty():
    assert normalize_token_usage(None) is None
    assert normalize_token_usage({}) is None
    assert normalize_token_usage({"totalTokens": 12}) is None
    assert normalize_token_usage({"total_tokens": 12}) is None


def test_normalize_provider_shapes():
    assert normalize_token_usage({"inputTokens": 10, "outputTokens": 4}) == {
        "input_tokens": 10,
        "output_tokens": 4,
    }
    assert normalize_token_usage(
        {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "prompt_tokens_details": {"cached_tokens": 40},
            "completion_tokens_details": {"reasoning_tokens": 12},
        }
    ) == {
        "input_tokens": 100,
        "output_tokens": 50,
        "cache_read_input_tokens": 40,
        "reasoning_output_tokens": 12,
    }
    assert normalize_token_usage(
        {
            "input_tokens": 100,
            "output_tokens": 50,
            "input_tokens_details": {
                "cached_tokens": 40,
                "cache_write_tokens": 8,
            },
            "output_tokens_details": {"reasoning_tokens": 12},
        }
    ) == {
        "input_tokens": 100,
        "output_tokens": 50,
        "cache_read_input_tokens": 40,
        "cache_creation_input_tokens": 8,
        "reasoning_output_tokens": 12,
    }
    assert normalize_token_usage(
        {
            "inputTokens": 20,
            "outputTokens": 6,
            "inputTokenDetails": {
                "noCacheTokens": 10,
                "cacheReadTokens": 7,
                "cacheWriteTokens": 3,
            },
            "outputTokenDetails": {
                "textTokens": 4,
                "reasoningTokens": 2,
            },
        }
    ) == {
        "input_tokens": 20,
        "output_tokens": 6,
        "cache_read_input_tokens": 7,
        "cache_creation_input_tokens": 3,
        "reasoning_output_tokens": 2,
    }
    assert normalize_token_usage(
        {"tokenUsage": {"promptTokens": 9, "completionTokens": 3}}
    ) == {"input_tokens": 9, "output_tokens": 3}
    assert normalize_token_usage({"input_tokens": 0, "output_tokens": 0}) == {
        "input_tokens": 0,
        "output_tokens": 0,
    }


def test_normalize_rejects_non_finite_numbers():
    inf = float("inf")
    nan = float("nan")
    # NaN/inf token counts are unusable — omit rather than emit them.
    assert normalize_token_usage({"inputTokens": inf, "outputTokens": 4}) == {
        "output_tokens": 4
    }
    assert normalize_token_usage({"prompt_tokens": nan}) is None


def test_token_usage_attributes():
    attrs = token_usage_attributes(
        {
            "input_tokens": 1,
            "output_tokens": 2,
            "cache_read_input_tokens": 3,
            "reasoning_output_tokens": 4,
        }
    )
    assert attrs["gen_ai.usage.input_tokens"] == 1
    assert attrs["llm.token_count.prompt"] == 1
    assert attrs["gen_ai.usage.output_tokens"] == 2
    assert attrs["llm.token_count.completion"] == 2
    assert attrs["gen_ai.usage.cache_read.input_tokens"] == 3
    assert attrs["gen_ai.usage.reasoning.output_tokens"] == 4
