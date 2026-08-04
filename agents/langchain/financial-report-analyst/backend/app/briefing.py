from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, col, delete, select

from app.config import settings
from app.database import engine
from app.llm import reasoning_model
from app.models import Document, KPIRecord, TableBlock, TextBlock, VisualBlock, WorkspaceBrief, WorkspaceBriefRead, json_loads, now_utc


BRIEF_SYSTEM_PROMPT = """You write compact analyst workspace briefs for a financial-report Deep Agent.
Use only the supplied uploaded-document extraction summary. No live web or market data.
Return strict JSON with: summary, periods, companies, key_kpis, visual_findings,
suggested_questions, missing_evidence, confidence.
Suggested questions should be useful human-in-the-loop investigation prompts the user can approve or edit."""


class BriefPayload(BaseModel):
    summary: str = ""
    periods: list[str] = Field(default_factory=list)
    companies: list[str] = Field(default_factory=list)
    key_kpis: list[str] = Field(default_factory=list)
    visual_findings: list[str] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    confidence: str = "medium"

    @field_validator("periods", "companies", "key_kpis", "visual_findings", "suggested_questions", "missing_evidence", mode="before")
    @classmethod
    def coerce_string_list(cls, value: Any) -> list[str]:
        if value is None or value == "":
            return []
        if isinstance(value, list):
            return [_brief_item_to_string(item) for item in value if item is not None and item != ""]
        if isinstance(value, dict):
            return [f"{key}: {_brief_item_to_string(item)}" for key, item in value.items()]
        return [_brief_item_to_string(value)]

    @field_validator("confidence", mode="before")
    @classmethod
    def coerce_confidence(cls, value: Any) -> str:
        if value is None or value == "":
            return "medium"
        if isinstance(value, (int, float)):
            if value >= 0.75:
                return "high"
            if value <= 0.4:
                return "low"
            return "medium"
        return str(value)


def refresh_workspace_brief(project_id: str) -> WorkspaceBriefRead | None:
    if not settings.enable_model_calls:
        raise RuntimeError("AI model calls are disabled. Set FRA_ENABLE_MODEL_CALLS=1 and restart the backend.")
    if not settings.nebius_api_key:
        raise RuntimeError("Nebius API key is required for workspace briefing. Set NEBIUS_API_KEY and restart the backend.")
    with Session(engine) as session:
        documents = session.exec(
            select(Document).where(Document.project_id == project_id, Document.status == "ready").order_by(Document.created_at.desc())
        ).all()
        if not documents:
            session.exec(delete(WorkspaceBrief).where(WorkspaceBrief.project_id == project_id))
            session.commit()
            return None
        source = _brief_source(session, documents)
        payload = _model_brief(source)
        existing = session.exec(select(WorkspaceBrief).where(WorkspaceBrief.project_id == project_id)).first()
        brief = existing or WorkspaceBrief(project_id=project_id)
        brief.summary = payload.summary[:3000]
        brief.periods_json = _dump(payload.periods[:12])
        brief.companies_json = _dump(payload.companies[:12])
        brief.key_kpis_json = _dump(payload.key_kpis[:16])
        brief.visual_findings_json = _dump(payload.visual_findings[:12])
        brief.suggested_questions_json = _dump(payload.suggested_questions[:8])
        brief.missing_evidence_json = _dump(payload.missing_evidence[:10])
        brief.confidence = payload.confidence or "medium"
        brief.source_document_count = len(documents)
        brief.updated_at = now_utc()
        session.add(brief)
        session.commit()
        session.refresh(brief)
        return brief_to_read(brief)


def get_workspace_brief(project_id: str) -> WorkspaceBriefRead | None:
    with Session(engine) as session:
        brief = session.exec(select(WorkspaceBrief).where(WorkspaceBrief.project_id == project_id)).first()
        return brief_to_read(brief) if brief else None


def clear_workspace_brief(project_id: str) -> None:
    with Session(engine) as session:
        session.exec(delete(WorkspaceBrief).where(WorkspaceBrief.project_id == project_id))
        session.commit()


def brief_to_read(brief: WorkspaceBrief) -> WorkspaceBriefRead:
    return WorkspaceBriefRead(
        project_id=brief.project_id,
        summary=brief.summary,
        periods=_clean_brief_list(json_loads(brief.periods_json, [])),
        companies=_clean_brief_list(json_loads(brief.companies_json, [])),
        key_kpis=_clean_brief_list(json_loads(brief.key_kpis_json, []), max_items=8, max_chars=220),
        visual_findings=_clean_brief_list(json_loads(brief.visual_findings_json, []), max_items=8, max_chars=240),
        suggested_questions=_clean_brief_list(json_loads(brief.suggested_questions_json, []), max_items=8, max_chars=260),
        missing_evidence=_clean_brief_list(json_loads(brief.missing_evidence_json, []), max_items=8, max_chars=260),
        confidence=brief.confidence,
        source_document_count=brief.source_document_count,
        updated_at=brief.updated_at,
    )


def _brief_source(session: Session, documents: list[Document]) -> str:
    doc_ids = [document.id for document in documents]
    text_blocks = session.exec(select(TextBlock).where(col(TextBlock.document_id).in_(doc_ids))).all()
    tables = session.exec(select(TableBlock).where(col(TableBlock.document_id).in_(doc_ids))).all()
    visuals = session.exec(select(VisualBlock).where(col(VisualBlock.document_id).in_(doc_ids))).all()
    kpis = session.exec(select(KPIRecord).where(col(KPIRecord.document_id).in_(doc_ids))).all()
    doc_names = {document.id: document.filename for document in documents}
    sections = [
        "Documents:",
        *[
            (
                f"- {document.filename}: pages={document.page_count}, status={document.status}, "
                f"vision={document.vision_coverage} {document.vision_pages_analyzed}/{document.vision_pages_possible}, "
                f"summary={_truncate(document.summary, 700)}"
            )
            for document in documents
        ],
        "\nRepresentative text:",
        *[f"- {doc_names.get(block.document_id, '')} p.{block.page_number}: {_truncate(block.text, 500)}" for block in text_blocks[:10]],
        "\nRepresentative tables:",
        *[f"- {doc_names.get(table.document_id, '')} p.{table.page_number}: {_truncate(table.table_markdown, 500)}" for table in tables[:8]],
        "\nCosmos visual observations:",
        *[f"- {doc_names.get(visual.document_id, '')} p.{visual.page_number}: {_truncate(visual.summary, 500)}" for visual in visuals[:12]],
        "\nKPI records:",
        *[
            (
                f"- {doc_names.get(kpi.document_id, '')} p.{kpi.page_number}: {kpi.metric} "
                f"{kpi.period or 'period n/a'} {kpi.segment or ''} = {kpi.value:g}{kpi.unit}"
            )
            for kpi in kpis[:40]
        ],
    ]
    return "\n".join(section for section in sections if section is not None)[:18000]


def _model_brief(source: str) -> BriefPayload:
    response = reasoning_model().invoke(
        [
            {"role": "system", "content": BRIEF_SYSTEM_PROMPT},
            {"role": "user", "content": source},
        ]
    )
    content = str(getattr(response, "content", None) or response)
    return BriefPayload.model_validate(json.loads(_extract_json_object(content)))


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


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def _brief_item_to_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def _clean_brief_list(values: list[Any], max_items: int = 12, max_chars: int = 180) -> list[str]:
    cleaned: list[str] = []
    for value in values[:max_items]:
        text = _humanize_brief_text(_brief_item_to_string(value))
        if text:
            cleaned.append(_truncate(text, max_chars))
    return cleaned


def _humanize_brief_text(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    label = ""
    payload = text
    if ": {" in text:
        label, payload = text.split(": ", 1)
    if payload.startswith("{") and payload.endswith("}"):
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return text
        parts = [f"{_humanize_metric_name(key)} {item}" for key, item in list(data.items())[:5]]
        suffix = "; ".join(parts)
        return f"{label}: {suffix}" if label else suffix
    return text


def _humanize_metric_name(value: str) -> str:
    return value.replace("_", " ").replace(" pct", " %").replace(" YoY", " YoY").strip()


def _truncate(value: str, limit: int) -> str:
    compact = " ".join((value or "").split())
    return compact[:limit] + ("..." if len(compact) > limit else "")
