"""Shared formatting and stream-normalization helpers for both frontends."""

from __future__ import annotations

import json
from typing import Any

TODO_STATUSES = frozenset({"pending", "in_progress", "completed"})


def short_text(text: str, limit: int = 240) -> str:
    """Collapse whitespace and truncate text for compact activity displays."""
    text = text.strip().replace("\n", " ")
    return text if len(text) <= limit else text[: limit - 1] + "…"


def namespace_label(namespace: tuple[str, ...]) -> str:
    """Format a LangGraph subgraph namespace for user-facing activity logs."""
    if not namespace:
        return "lead"
    parts = []
    for entry in namespace:
        segments = entry.split(":")
        parts.append(segments[1] if len(segments) >= 2 else entry)
    return " → ".join(parts)


def try_parse_json(value: Any) -> Any:
    """Parse JSON-looking strings, returning all other values unchanged."""
    if not isinstance(value, str):
        return value
    candidate = value.strip()
    if not candidate or candidate[0] not in "{[":
        return value
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return value


def normalize_tool_args(args: Any) -> dict[str, Any]:
    """Return a safe mapping for streamed, pre-validation tool arguments."""
    parsed = try_parse_json(args)
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def format_args(args: Any) -> str:
    """Format tool arguments as a compact, human-readable string."""
    normalized = normalize_tool_args(args)
    if not normalized:
        return ""

    parts = []
    for key, value in normalized.items():
        if isinstance(value, str):
            parts.append(f"{key}={json.dumps(short_text(value, 80))}")
        elif isinstance(value, (list, dict)):
            parts.append(f"{key}={short_text(json.dumps(value, default=str), 80)}")
        else:
            parts.append(f"{key}={value!r}")
    return ", ".join(parts)


def normalize_todos(todos: Any) -> list[dict[str, str]]:
    """Normalize provider-specific todo payloads for frontend consumers."""
    parsed = try_parse_json(todos)
    if parsed is None or parsed == "":
        return []
    if isinstance(parsed, dict):
        for wrapper in ("todos", "item", "items"):
            if wrapper in parsed and isinstance(parsed[wrapper], list):
                parsed = parsed[wrapper]
                break
        else:
            parsed = [parsed]
    elif not isinstance(parsed, list):
        parsed = [parsed]

    normalized: list[dict[str, str]] = []
    for item in parsed:
        if isinstance(item, dict):
            status = str(item.get("status", "pending"))
            if status not in TODO_STATUSES:
                status = "pending"
            content = str(item.get("content", item))
        else:
            status = "pending"
            content = str(item)
        normalized.append({"status": status, "content": content})
    return normalized


def recover_inline_write_file(content: str) -> tuple[str, str] | None:
    """Recover a complete MiniMax ``write_file`` envelope emitted as text.

    A missing closing content tag is treated as truncation and rejected.
    """
    normalized = content.replace("]<]minimax[>[", "")
    if '<invoke name="write_file">' not in normalized or "<content>" not in normalized:
        return None

    if "<file_path>" in normalized and "</file_path>" in normalized:
        path = normalized.split("<file_path>", 1)[1].split("</file_path>", 1)[0].strip()
    elif "<filepath>" in normalized and "</filepath>" in normalized:
        path = normalized.split("<filepath>", 1)[1].split("</filepath>", 1)[0].strip()
    elif "</filepath>" in normalized:
        path = normalized.split('name="write_file">', 1)[1].split("</filepath>", 1)[0].strip()
    else:
        return None

    file_content = normalized.split("<content>", 1)[1]
    if "</content>" not in file_content:
        return None
    file_content = file_content.split("</content>", 1)[0].strip()
    if not path or not file_content:
        return None
    return path, file_content


def file_content(entry: object) -> str | None:
    """Unwrap a Deep Agents virtual-filesystem entry into text."""
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        content = entry.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "\n".join(str(line) for line in content)
    return None


def extract_brief(files: dict[str, object]) -> str | None:
    """Find ``brief.md`` in a Deep Agents virtual-filesystem snapshot."""
    for key in ("brief.md", "/brief.md"):
        if key in files:
            return file_content(files[key])
    for key, value in files.items():
        if key.endswith("brief.md"):
            return file_content(value)
    return None
