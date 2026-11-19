from uselemma_tracing.debug_delivery import (
    PRODUCTION_BASE_URL,
    api_key_suffix,
    build_config_warnings,
    ingest_failure_hint,
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
