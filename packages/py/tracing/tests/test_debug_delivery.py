from uselemma_tracing.debug_delivery import (
    INGEST_RETRY_BASE_DELAY_SECONDS,
    INGEST_RETRY_MAX_DELAY_SECONDS,
    PRODUCTION_BASE_URL,
    api_key_suffix,
    build_config_warnings,
    ingest_failure_hint,
    ingest_retry_delay_seconds,
    is_retryable_ingest_status,
    is_valid_project_id,
    pick_response_headers,
)


def test_is_valid_project_id():
    assert is_valid_project_id("10000000-0000-0000-0000-000000000001")
    assert not is_valid_project_id("bad-id")


def test_api_key_suffix():
    assert api_key_suffix("sk_live_abc12345") == "...2345"
    assert api_key_suffix("key") == "key"


def test_build_config_warnings():
    assert build_config_warnings("http://localhost:8000", "bad-id") == [
        f"baseUrl is not production ({PRODUCTION_BASE_URL})",
        "projectId is not a valid UUID",
    ]


def test_ingest_failure_hint():
    assert "LEMMA_API_KEY" in ingest_failure_hint(401)
    assert ingest_failure_hint(503) is None


def test_pick_response_headers():
    assert pick_response_headers(
        {"CF-Ray": "abc123", "Content-Type": "application/json"}
    ) == {"cf-ray": "abc123"}


def test_is_retryable_ingest_status():
    for status in (408, 429, 500, 502, 503, 504):
        assert is_retryable_ingest_status(status)
    for status in (400, 401, 403, 404, 413, 422):
        assert not is_retryable_ingest_status(status)


def test_ingest_retry_delay_doubles_with_jitter():
    base = INGEST_RETRY_BASE_DELAY_SECONDS
    assert ingest_retry_delay_seconds(1, None, lambda: 0.0) == base / 2
    assert ingest_retry_delay_seconds(1, None, lambda: 1.0) == base
    assert ingest_retry_delay_seconds(2, None, lambda: 0.0) == base
    assert ingest_retry_delay_seconds(2, None, lambda: 1.0) == base * 2


def test_ingest_retry_delay_honors_retry_after_up_to_the_cap():
    base = INGEST_RETRY_BASE_DELAY_SECONDS
    assert ingest_retry_delay_seconds(1, "1", lambda: 0.0) == 1.0
    assert ingest_retry_delay_seconds(1, "0", lambda: 1.0) == base
    assert (
        ingest_retry_delay_seconds(1, "60", lambda: 0.0)
        == INGEST_RETRY_MAX_DELAY_SECONDS
    )
    for unusable in ("Wed, 21 Oct 2026 07:28:00 GMT", " ", "nan", "-1"):
        assert ingest_retry_delay_seconds(1, unusable, lambda: 0.0) == base / 2
