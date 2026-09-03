from __future__ import annotations

import os
from pathlib import Path


def load_example_env() -> None:
    """Load the nearest `.env` files (example folder, then examples/.env)."""
    seen: set[Path] = set()
    for start in (Path.cwd(), Path(__file__).resolve()):
        directory = start if start.is_dir() else start.parent
        for _ in range(6):
            candidate = directory / ".env"
            if candidate not in seen and candidate.is_file():
                seen.add(candidate)
                _apply_env_file(candidate)
            if directory.parent == directory:
                break
            directory = directory.parent


def _apply_env_file(path: Path) -> None:
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def require_openai_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError(
            "Set OPENAI_API_KEY. Copy examples/.env.example to examples/.env."
        )
    return key
