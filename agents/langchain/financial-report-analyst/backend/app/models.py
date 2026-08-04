from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlmodel import Field as SQLField
from sqlmodel import SQLModel


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid4().hex


class Project(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    name: str
    created_at: datetime = SQLField(default_factory=now_utc)


class Document(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    project_id: str = SQLField(index=True, foreign_key="project.id")
    filename: str
    content_type: str = ""
    storage_path: str
    status: str = SQLField(default="uploaded", index=True)
    page_count: int = 0
    vision_coverage: str = SQLField(default="none", index=True)
    vision_pages_analyzed: int = 0
    vision_pages_possible: int = 0
    summary: str = ""
    error: str = ""
    created_at: datetime = SQLField(default_factory=now_utc)


class Page(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    document_id: str = SQLField(index=True, foreign_key="document.id")
    page_number: int = SQLField(index=True)
    text: str = ""
    image_path: str = ""


class TextBlock(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    document_id: str = SQLField(index=True, foreign_key="document.id")
    page_number: int = SQLField(index=True)
    text: str
    bbox_json: str = "[]"
    confidence: float = 1.0
    extraction_method: str = "text"


class TableBlock(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    document_id: str = SQLField(index=True, foreign_key="document.id")
    page_number: int = SQLField(index=True)
    table_markdown: str
    rows_json: str = "[]"
    bbox_json: str = "[]"
    confidence: float = 0.8
    extraction_method: str = "table"


class VisualBlock(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    document_id: str = SQLField(index=True, foreign_key="document.id")
    page_number: int = SQLField(index=True)
    title: str = ""
    kind: str = "page"
    summary: str = ""
    image_path: str = ""
    data_json: str = "{}"
    bbox_json: str = "[]"
    confidence: float = 0.5
    extraction_method: str = "render"


class KPIRecord(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    document_id: str = SQLField(index=True, foreign_key="document.id")
    metric: str = SQLField(index=True)
    period: str = SQLField(default="", index=True)
    value: float
    unit: str = ""
    segment: str = ""
    page_number: int = SQLField(index=True)
    source_text: str = ""
    confidence: float = 0.55
    extraction_method: str = "regex"


class Citation(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    document_id: str = SQLField(index=True, foreign_key="document.id")
    page_number: int = SQLField(index=True)
    source_kind: str
    source_id: str = ""
    label: str
    bbox_json: str = "[]"


class ChatThread(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    project_id: str = SQLField(index=True, foreign_key="project.id")
    title: str = "Analysis"
    created_at: datetime = SQLField(default_factory=now_utc)


class Answer(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    thread_id: str = SQLField(index=True, foreign_key="chatthread.id")
    project_id: str = SQLField(index=True, foreign_key="project.id")
    question: str
    answer: str
    citations_json: str = "[]"
    created_at: datetime = SQLField(default_factory=now_utc)


class Job(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    project_id: str = SQLField(index=True)
    document_id: str = SQLField(index=True)
    status: str = SQLField(default="queued", index=True)
    message: str = ""
    created_at: datetime = SQLField(default_factory=now_utc)
    updated_at: datetime = SQLField(default_factory=now_utc)


class WorkspaceBrief(SQLModel, table=True):
    id: str = SQLField(default_factory=new_id, primary_key=True)
    project_id: str = SQLField(index=True, foreign_key="project.id")
    summary: str = ""
    periods_json: str = "[]"
    companies_json: str = "[]"
    key_kpis_json: str = "[]"
    visual_findings_json: str = "[]"
    suggested_questions_json: str = "[]"
    missing_evidence_json: str = "[]"
    confidence: str = "medium"
    source_document_count: int = 0
    created_at: datetime = SQLField(default_factory=now_utc)
    updated_at: datetime = SQLField(default_factory=now_utc)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class ProjectRead(BaseModel):
    id: str
    name: str
    created_at: datetime


class DocumentRead(BaseModel):
    id: str
    project_id: str
    filename: str
    content_type: str
    status: str
    page_count: int
    vision_coverage: str = "none"
    vision_pages_analyzed: int = 0
    vision_pages_possible: int = 0
    summary: str
    error: str
    created_at: datetime
    text_count: int = 0
    table_count: int = 0
    visual_count: int = 0
    kpi_count: int = 0


class JobRead(BaseModel):
    id: str
    project_id: str
    document_id: str
    status: str
    message: str
    updated_at: datetime


class PageRead(BaseModel):
    id: str
    document_id: str
    page_number: int
    text: str
    image_url: str | None = None
    visual_summary: str = ""
    visual_count: int = 0


class WorkspaceBriefRead(BaseModel):
    project_id: str
    summary: str = ""
    periods: list[str] = Field(default_factory=list)
    companies: list[str] = Field(default_factory=list)
    key_kpis: list[str] = Field(default_factory=list)
    visual_findings: list[str] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    confidence: str = "medium"
    source_document_count: int = 0
    updated_at: datetime | None = None


class CitationRead(BaseModel):
    document_id: str
    document_name: str
    page_number: int
    source_kind: str
    source_id: str = ""
    label: str
    artifact_url: str | None = None
    bbox_json: str = "[]"
    confidence: float = 0.7


class EvidenceCitation(BaseModel):
    document_id: str
    document_name: str
    page_number: int
    source_kind: str
    source_id: str = ""
    label: str
    artifact_url: str | None = None
    bbox_json: str = "[]"
    confidence: float = 0.7


class AgentAnswer(BaseModel):
    summary: str = ""
    management_stated_causes: list[str] = Field(default_factory=list)
    arithmetic_facts: list[str] = Field(default_factory=list)
    inference: list[str] = Field(default_factory=list)
    citations: list[EvidenceCitation] = Field(default_factory=list)
    confidence: str = "medium"
    needs_more_evidence: list[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    project_id: str
    question: str
    thread_id: str | None = None
    human_review: bool = False


class ResearchPlanRequest(BaseModel):
    project_id: str
    question: str
    attachments: list[str] = Field(default_factory=list)


class ResearchPlanResponse(BaseModel):
    summary: str
    steps: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    subagents: list[str] = Field(default_factory=list)
    evidence_needed: list[str] = Field(default_factory=list)
    output_format: list[str] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    confidence: str = "medium"


class HumanReviewDecision(BaseModel):
    type: str
    message: str | None = None


class HumanReviewRequest(BaseModel):
    project_id: str
    thread_id: str
    decisions: list[HumanReviewDecision]


class ChatResponse(BaseModel):
    thread_id: str
    answer: str
    citations: list[CitationRead]
    structured_answer: AgentAnswer | None = None
    interrupted: bool = False
    review_actions: list[dict[str, Any]] = Field(default_factory=list)


class ChatHistoryItem(BaseModel):
    id: str
    thread_id: str
    question: str
    answer: str
    citations: list[CitationRead] = Field(default_factory=list)
    created_at: datetime


class CompareRequest(BaseModel):
    project_id: str
    metric: str
    document_ids: list[str] | None = None
    period: str | None = None


class ComparePoint(BaseModel):
    document_id: str
    document_name: str
    metric: str
    period: str
    value: float
    unit: str
    segment: str
    page_number: int
    source_text: str


class CompareResponse(BaseModel):
    metric: str
    points: list[ComparePoint]


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return fallback
