from uselemma_tracing.debug_delivery import (
    PRODUCTION_BASE_URL,
    api_key_suffix,
    build_config_warnings,
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


def test_pick_response_headers():
    assert pick_response_headers(
        {"cf-ray": "abc123", "content-type": "application/json"}
    ) == {"cf-ray": "abc123"}
