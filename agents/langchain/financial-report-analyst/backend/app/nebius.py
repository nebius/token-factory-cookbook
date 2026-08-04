from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from openai import OpenAI
from pydantic import BaseModel, Field, field_validator

from app.config import settings

VISION_SYSTEM_PROMPT = """You are a financial document vision analyst.
Extract only what is visible. Identify chart titles, axes, legends, KPI labels, values,
units, time periods, and any visually obvious table/chart mismatches. Return strict JSON only.
Always include uncertainty when the image is low quality or a value is approximate."""


class VisualObservation(BaseModel):
    title: str = ""
    visual_type: str = "page"
    periods: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    series: list[Any] = Field(default_factory=list)
    visible_values: list[Any] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    chart_table_conflicts: list[Any] = Field(default_factory=list)
    summary: str = ""
    uncertainty: str = "not inspected"

    @field_validator("periods", "metrics", "labels", mode="before")
    @classmethod
    def _string_list(cls, value: Any) -> list[str]:
        if value in (None, ""):
            return []
        if isinstance(value, list):
            return [str(item) for item in value]
        return [str(value)]

    @field_validator("series", "visible_values", "chart_table_conflicts", mode="before")
    @classmethod
    def _any_list(cls, value: Any) -> list[Any]:
        if value in (None, ""):
            return []
        if isinstance(value, list):
            return value
        return [value]


def _image_block(path: Path) -> dict:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}}


def analyze_visual(path: Path, prompt: str | None = None) -> str:
    return analyze_visual_observation(path, prompt).model_dump_json()


def analyze_visual_observation(path: Path, prompt: str | None = None) -> VisualObservation:
    if not settings.enable_model_calls or not settings.nebius_api_key:
        return VisualObservation(
            summary="Vision model not configured; Cosmos visual extraction did not run.",
            uncertainty="model disabled",
        )
    client = OpenAI(base_url=settings.vision_base_url, api_key=settings.nebius_api_key, timeout=settings.model_timeout_seconds, max_retries=1)
    response = client.chat.completions.create(
        model=settings.vision_model,
        messages=[
            {"role": "system", "content": VISION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    _image_block(path),
                    {
                        "type": "text",
                        "text": prompt
                        or (
                            "Return JSON with keys title, visual_type, periods, metrics, series, visible_values, "
                            "labels, chart_table_conflicts, summary, and uncertainty. Summarize visible financial "
                            "evidence only; note charts, tables, KPIs, and values."
                        ),
                    },
                ],
            },
        ],
        max_tokens=1200,
        temperature=0.2,
        top_p=0.3,
    )
    content = response.choices[0].message.content or "{}"
    try:
        return VisualObservation.model_validate(json.loads(_extract_json_object(content)))
    except Exception:
        return VisualObservation(summary=content[:1600], uncertainty="model returned non-json text")


def _extract_json_object(content: str) -> str:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end >= start:
        return stripped[start : end + 1]
    return stripped
