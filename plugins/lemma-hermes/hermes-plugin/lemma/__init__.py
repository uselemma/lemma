from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


_LOCK = threading.RLock()
_TURNS: Dict[str, Dict[str, Any]] = {}
_SENSITIVE_KEY_PARTS = {
    "authorization",
    "cookie",
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return ""


def _safe(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return "[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:20000]
    if isinstance(value, (list, tuple)):
        return [_safe(item, depth + 1) for item in value[:200]]
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:200]:
            normalized = str(key).lower().replace("-", "_").replace(".", "_")
            if any(part in normalized for part in _SENSITIVE_KEY_PARTS):
                continue
            result[str(key)] = _safe(item, depth + 1)
        return result
    if hasattr(value, "model_dump"):
        try:
            return _safe(value.model_dump(), depth + 1)
        except Exception:
            return str(value)[:20000]
    if hasattr(value, "__dict__"):
        try:
            return _safe(vars(value), depth + 1)
        except Exception:
            return str(value)[:20000]
    return str(value)[:20000]


def _turn_key(session_id: str, turn_id: str, task_id: str = "") -> str:
    return turn_id or task_id or session_id


def _data_dir() -> Path:
    configured = os.getenv("LEMMA_HERMES_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    hermes_home = Path(os.getenv("HERMES_HOME", "~/.hermes")).expanduser()
    fallback = hermes_home / "lemma"
    try:
        location = json.loads(
            (fallback / "data-dir-location.json").read_text(encoding="utf-8")
        )
        data_dir = location.get("dataDir") if isinstance(location, dict) else None
        if location.get("version") == 1 and isinstance(data_dir, str) and data_dir:
            return Path(data_dir).expanduser().resolve()
    except Exception:
        pass
    return fallback


def _credentials_destination() -> Optional[Dict[str, str]]:
    try:
        value = json.loads((_data_dir() / "credentials.json").read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(value, dict):
        return None
    api_url = value.get("apiUrl")
    project_id = value.get("projectId")
    if not isinstance(api_url, str) or not isinstance(project_id, str):
        return None
    return {"apiUrl": api_url, "projectId": project_id}


def _write_pending(turn: Dict[str, Any]) -> Optional[Path]:
    destination = _credentials_destination()
    if destination is None:
        return None
    pending_dir = _data_dir() / "pending"
    pending_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(pending_dir, 0o700)
    except OSError:
        pass
    digest = hashlib.sha256(
        f"{turn['sessionId']}\0{turn['turnId']}".encode("utf-8")
    ).hexdigest()
    target = pending_dir / f"{digest}.json"
    temporary = pending_dir / f".{digest}.{os.getpid()}.tmp"
    payload = {
        "version": 1,
        "apiUrl": destination["apiUrl"],
        "projectId": destination["projectId"],
        "turn": turn,
    }
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))
        handle.write("\n")
    os.replace(temporary, target)
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass
    return target


def _spawn_flush() -> None:
    runtime = Path(__file__).resolve().parent / "runtime" / "flush.mjs"
    if not runtime.exists():
        return
    kwargs: Dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        )
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([os.getenv("NODE", "node"), str(runtime)], **kwargs)


def on_pre_llm_call(
    *,
    session_id: str = "",
    task_id: str = "",
    turn_id: str = "",
    user_message: Any = None,
    model: str = "",
    platform: str = "",
    **_: Any,
) -> None:
    key = _turn_key(session_id, turn_id, task_id)
    if not session_id or not key:
        return
    with _LOCK:
        _TURNS[key] = {
            "version": 1,
            "sessionId": session_id,
            "turnId": key,
            "prompt": _text(user_message),
            "response": "",
            "startedAt": _now(),
            "endedAt": _now(),
            "model": model or None,
            "provider": None,
            "metadata": {"hermes.platform": platform} if platform else {},
            "tools": [],
        }


def on_pre_api_request(
    *,
    session_id: str = "",
    task_id: str = "",
    turn_id: str = "",
    model: str = "",
    provider: str = "",
    started_at: Any = None,
    **_: Any,
) -> None:
    key = _turn_key(session_id, turn_id, task_id)
    with _LOCK:
        turn = _TURNS.get(key)
        if turn is None:
            return
        turn["model"] = model or turn.get("model")
        turn["provider"] = provider or turn.get("provider")
        turn["generationStartedAt"] = (
            datetime.fromtimestamp(float(started_at), timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
            if isinstance(started_at, (int, float))
            else _now()
        )


def on_post_api_request(
    *,
    session_id: str = "",
    task_id: str = "",
    turn_id: str = "",
    assistant_message: Any = None,
    response_model: Any = None,
    model: str = "",
    provider: str = "",
    **_: Any,
) -> None:
    key = _turn_key(session_id, turn_id, task_id)
    with _LOCK:
        turn = _TURNS.get(key)
        if turn is None:
            return
        content = getattr(assistant_message, "content", None)
        if content is None and isinstance(assistant_message, dict):
            content = assistant_message.get("content")
        text = _text(content)
        if text:
            turn["response"] = text
        served_model = response_model if isinstance(response_model, str) else model
        turn["model"] = served_model or turn.get("model")
        turn["provider"] = provider or turn.get("provider")
        turn["generationEndedAt"] = _now()


def on_api_request_error(
    *,
    session_id: str = "",
    task_id: str = "",
    turn_id: str = "",
    retryable: Any = None,
    error_type: str = "",
    **_: Any,
) -> None:
    if retryable is not False:
        return
    key = _turn_key(session_id, turn_id, task_id)
    with _LOCK:
        turn = _TURNS.get(key)
        if turn is not None and not turn.get("response"):
            turn["response"] = f"Hermes model request failed: {error_type or 'api_request_error'}"


def on_pre_tool_call(
    *,
    session_id: str = "",
    task_id: str = "",
    turn_id: str = "",
    tool_call_id: str = "",
    tool_name: str = "",
    args: Any = None,
    **_: Any,
) -> None:
    key = _turn_key(session_id, turn_id, task_id)
    with _LOCK:
        turn = _TURNS.get(key)
        if turn is None:
            return
        identifier = tool_call_id or f"{tool_name}:{len(turn['tools'])}"
        turn["tools"].append(
            {
                "toolUseId": identifier,
                "toolName": tool_name or "tool",
                "input": _safe(args),
                "startedAt": _now(),
            }
        )


def on_post_tool_call(
    *,
    session_id: str = "",
    task_id: str = "",
    turn_id: str = "",
    tool_call_id: str = "",
    tool_name: str = "",
    args: Any = None,
    result: Any = None,
    status: Any = None,
    error_message: Any = None,
    **_: Any,
) -> None:
    key = _turn_key(session_id, turn_id, task_id)
    with _LOCK:
        turn = _TURNS.get(key)
        if turn is None:
            return
        identifier = tool_call_id or ""
        tool = next(
            (
                item
                for item in reversed(turn["tools"])
                if (identifier and item["toolUseId"] == identifier)
                or (not identifier and item["toolName"] == tool_name)
            ),
            None,
        )
        if tool is None:
            identifier = identifier or f"{tool_name}:{len(turn['tools'])}"
            tool = {
                "toolUseId": identifier,
                "toolName": tool_name or "tool",
                "input": _safe(args),
            }
            turn["tools"].append(tool)
        tool["endedAt"] = _now()
        if str(status).lower() in {"error", "failed", "cancelled", "timeout"}:
            tool["error"] = _safe(error_message or result or status)
        else:
            tool["output"] = _safe(result)


def on_session_end(
    *,
    session_id: str = "",
    task_id: str = "",
    turn_id: str = "",
    completed: Any = None,
    failed: Any = None,
    interrupted: Any = None,
    model: str = "",
    platform: str = "",
    turn_exit_reason: str = "",
    **_: Any,
) -> None:
    key = _turn_key(session_id, turn_id, task_id)
    with _LOCK:
        turn = _TURNS.pop(key, None)
    if turn is None:
        return
    turn["endedAt"] = _now()
    turn["model"] = model or turn.get("model")
    turn["metadata"].update(
        {
            "hermes.completed": bool(completed),
            "hermes.failed": bool(failed),
            "hermes.interrupted": bool(interrupted),
            "hermes.turn_exit_reason": turn_exit_reason,
            "hermes.platform": platform,
        }
    )
    if not turn.get("response"):
        if failed:
            turn["response"] = "Hermes turn failed"
        elif interrupted:
            turn["response"] = "Hermes turn interrupted"
    if _write_pending(turn) is not None:
        try:
            _spawn_flush()
        except Exception:
            pass


def register(ctx: Any) -> None:
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    ctx.register_hook("pre_api_request", on_pre_api_request)
    ctx.register_hook("post_api_request", on_post_api_request)
    ctx.register_hook("api_request_error", on_api_request_error)
    ctx.register_hook("pre_tool_call", on_pre_tool_call)
    ctx.register_hook("post_tool_call", on_post_tool_call)
    ctx.register_hook("on_session_end", on_session_end)
