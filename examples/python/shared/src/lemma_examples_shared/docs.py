from __future__ import annotations

from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

DOCS_ORIGIN = "https://docs.uselemma.ai"
DOCS_INDEX = f"{DOCS_ORIGIN}/llms.txt"
_USER_AGENT = "lemma-examples-docs-agent/0.0.0"


def _get(url: str, label: str) -> str:
    request = Request(url, headers={"User-Agent": _USER_AGENT})
    with urlopen(request, timeout=30) as response:
        status = getattr(response, "status", 200)
        if status >= 400:
            raise RuntimeError(f"{label} failed: {status}")
        return response.read().decode("utf-8")


def list_docs() -> str:
    return _get(DOCS_INDEX, "list_docs")


def to_markdown_docs_url(url: str) -> str:
    trimmed = url.strip()
    href = urljoin(DOCS_ORIGIN + "/", trimmed.lstrip("/")) if trimmed.startswith("/") else trimmed
    parsed = urlparse(href)
    if parsed.scheme != "https" or parsed.netloc != "docs.uselemma.ai":
        raise ValueError("read_doc only accepts https://docs.uselemma.ai URLs")
    path = parsed.path.rstrip("/")
    if not path.endswith(".md"):
        path = f"{path}.md"
    return urlunparse(parsed._replace(path=path))


def read_doc(url: str) -> str:
    return _get(to_markdown_docs_url(url), "read_doc")
