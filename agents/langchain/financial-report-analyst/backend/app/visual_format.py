from __future__ import annotations

import ast
import json
import re
from typing import Any

from app.models import VisualBlock


def format_visual_summary(visuals: list[VisualBlock], limit: int = 2400) -> str:
    return "\n\n".join(summary for visual in visuals if (summary := format_visual_observation(visual)))[:limit]


def format_visual_observation(visual: VisualBlock) -> str:
    data = _json_loads(visual.data_json, {})
    if not isinstance(data, dict):
        data = {}
    embedded = _extract_visual_json(data.get("summary") or visual.summary)
    if embedded:
        data = {**data, **embedded}

    title = _clean_visual_text(data.get("title") or visual.title)
    visual_type = _clean_visual_text(data.get("visual_type") or visual.kind)
    summary = _clean_visual_text(data.get("summary") or visual.summary)
    periods = _clean_visual_list(data.get("periods"))
    metrics = _clean_visual_list(data.get("metrics"))
    values = _clean_visual_list(data.get("visible_values"), limit=8)
    conflicts = _clean_visual_list(data.get("chart_table_conflicts"), limit=5)
    labels = _clean_visual_list(data.get("labels"), limit=8)
    uncertainty = _clean_visual_text(data.get("uncertainty"))

    heading = title or "Visual page"
    if visual_type:
        heading = f"{heading} ({visual_type})"
    lines = [heading]
    if summary and summary != heading:
        lines.append(summary)
    if periods:
        lines.append(f"Periods: {', '.join(periods)}")
    if metrics:
        lines.append(f"Metrics: {', '.join(metrics)}")
    if values:
        lines.append(f"Visible values: {'; '.join(values)}")
    if conflicts:
        lines.append(f"Possible conflicts: {'; '.join(conflicts)}")
    if labels and not metrics:
        lines.append(f"Labels: {', '.join(labels)}")
    if uncertainty and uncertainty.lower() not in {"not inspected", "none", "unknown", "[]"}:
        lines.append(f"Uncertainty: {uncertainty}")
    return "\n".join(lines)


def _clean_visual_list(value: object, limit: int = 6) -> list[str]:
    if value in (None, ""):
        return []
    items = value if isinstance(value, list) else [value]
    cleaned: list[str] = []
    for item in items[:limit]:
        text = _clean_visual_text(item)
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned


def _clean_visual_text(value: object) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, str):
        stripped = value.strip()
        embedded = _extract_visual_json(stripped)
        if embedded:
            return _clean_visual_text(embedded)
        if stripped.startswith(("{", "[")):
            parsed = _json_loads(stripped, None)
            if parsed is not None:
                return _clean_visual_text(parsed)
            try:
                return _clean_visual_text(ast.literal_eval(stripped))
            except (SyntaxError, ValueError):
                pass
        if _looks_like_jsonish_visual(stripped):
            return _format_jsonish_visual_text(stripped)
        return stripped
    if isinstance(value, dict):
        labeled = _format_labeled_visual_value(value)
        if labeled:
            return labeled
        parts: list[str] = []
        for key, nested_value in list(value.items())[:8]:
            nested_text = _clean_visual_text(nested_value)
            if nested_text:
                parts.append(f"{_humanize_key(str(key))}: {nested_text}")
        return "; ".join(parts)
    if isinstance(value, list):
        return "; ".join(text for item in value[:8] if (text := _clean_visual_text(item)))
    return str(value).strip()


def _extract_visual_json(value: object) -> dict[str, object]:
    if not isinstance(value, str):
        return {}
    stripped = value.strip()
    candidates: list[str] = []
    if stripped.startswith("```"):
        candidates.append(stripped.removeprefix("```json").removeprefix("```").removesuffix("```").strip())
    if "```json" in stripped:
        _, _, after = stripped.partition("```json")
        fenced, _, _ = after.partition("```")
        candidates.append(fenced.strip())
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end >= start:
        candidates.append(stripped[start : end + 1])
    for candidate in candidates:
        parsed = _json_loads(candidate, None)
        if isinstance(parsed, dict):
            return parsed
    return {}


def _looks_like_jsonish_visual(value: str) -> bool:
    lowered = value.lower()
    return (
        "```json" in lowered
        or lowered.startswith("{")
        or any(key in lowered for key in ('"title"', '"visual_type"', '"periods"', '"metrics"', '"visible_values"'))
    )


def _format_jsonish_visual_text(value: str) -> str:
    text = value.strip().strip("`")
    if text.lower().startswith("json"):
        text = text[4:].strip()
    parts: list[str] = []
    title = _regex_string_field(text, "title")
    visual_type = _regex_string_field(text, "visual_type")
    heading = title or ""
    if heading and visual_type:
        heading = f"{heading} ({visual_type})"
    elif visual_type:
        heading = visual_type
    if heading:
        parts.append(heading)
    summary = _regex_string_field(text, "summary")
    if summary and summary != title:
        parts.append(summary)
    for label, key, limit in (
        ("Periods", "periods", 6),
        ("Metrics", "metrics", 10),
        ("Visible values", "visible_values", 8),
        ("Labels", "labels", 8),
    ):
        values = _regex_array_strings(text, key, limit)
        if values:
            parts.append(f"{label}: {', '.join(values)}")
    uncertainty = _regex_string_field(text, "uncertainty")
    if uncertainty:
        parts.append(f"Uncertainty: {uncertainty}")
    if parts:
        return "\n".join(parts)
    compact = re.sub(r"[{}\[\]`]", " ", text)
    compact = re.sub(r'"([A-Za-z_ ]+)"\s*:', lambda match: f"{_humanize_key(match.group(1))}: ", compact)
    compact = " ".join(compact.replace('"', "").split())
    return compact[:1200]


def _regex_string_field(text: str, key: str) -> str:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*"((?:[^"\\]|\\.)*)"', text, flags=re.S)
    if not match:
        return ""
    return _clean_visual_text(match.group(1).replace('\\"', '"'))


def _regex_array_strings(text: str, key: str, limit: int) -> list[str]:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*\[(.*?)\]', text, flags=re.S)
    if not match:
        return []
    return [_clean_visual_text(item.replace('\\"', '"')) for item in re.findall(r'"((?:[^"\\]|\\.)*)"', match.group(1))[:limit]]


def _format_labeled_visual_value(value: dict[object, object]) -> str:
    label = _clean_visual_text(value.get("label"))
    if not label:
        return ""
    amount = _clean_visual_text(value.get("value"))
    change = _clean_visual_text(value.get("change"))
    note = _clean_visual_text(value.get("note"))
    detail = ", ".join(part for part in (amount, change, note) if part)
    return f"{label}: {detail}" if detail else label


def _humanize_key(value: str) -> str:
    return value.replace("_", " ").strip()


def _json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return fallback
