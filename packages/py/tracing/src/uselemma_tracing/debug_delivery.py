from __future__ import annotations

import re

PRODUCTION_BASE_URL = "https://api.uselemma.ai"
INGEST_PATH = "/traces/ingest"
EXPECTED_INGEST_SUCCESS_STATUS = 201

_UUID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def is_valid_project_id(project_id: str) -> bool:
    return bool(_UUID_REGEX.fullmatch(project_id))


def api_key_suffix(api_key: str) -> str:
    if len(api_key) <= 4:
        return api_key
    return f"...{api_key[-4:]}"


def build_config_warnings(base_url: str, project_id: str) -> list[str]:
    warnings: list[str] = []
    if base_url != PRODUCTION_BASE_URL:
        warnings.append(f"baseUrl is not production ({PRODUCTION_BASE_URL})")
    if not is_valid_project_id(project_id):
        warnings.append("projectId is not a valid UUID")
    return warnings


def ingest_failure_hint(status: int) -> str | None:
    hints = {
        401: "check LEMMA_API_KEY",
        403: "API key doesn't own this project_id",
        429: "ingest rate limit exceeded; retry with backoff",
        404: "baseUrl likely wrong (not Lemma API)",
    }
    return hints.get(status)


def pick_response_headers(headers: dict[str, str]) -> dict[str, str]:
    picked: dict[str, str] = {}
    lowered = {key.lower(): value for key, value in headers.items()}
    for name in ("cf-ray", "server", "date"):
        value = lowered.get(name)
        if value:
            picked[name] = value
    return picked
