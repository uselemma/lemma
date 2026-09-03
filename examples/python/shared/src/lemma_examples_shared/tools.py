from .docs import list_docs, read_doc


def execute_docs_tool(name: str, args: dict[str, object] | None = None) -> str:
    payload = args or {}
    if name == "list_docs":
        return list_docs()
    if name == "read_doc":
        url = payload.get("url")
        if not isinstance(url, str) or not url.strip():
            raise ValueError("read_doc requires a string url argument")
        return read_doc(url)
    raise ValueError(f"Unknown tool: {name}")
