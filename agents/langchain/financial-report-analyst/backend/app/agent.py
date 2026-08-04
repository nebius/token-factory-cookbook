from __future__ import annotations

import json
import re
import atexit
from datetime import datetime
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlmodel import Session, col, select

from app.config import settings
from app.database import engine
from app.briefing import get_workspace_brief
from app.kpi import delta, growth_rate, normalize_metric
from app.llm import reasoning_model
from app.models import (
    AgentAnswer,
    Answer,
    ChatResponse,
    ChatThread,
    CitationRead,
    ComparePoint,
    CompareResponse,
    Document,
    EvidenceCitation,
    HumanReviewDecision,
    KPIRecord,
    Page,
    ResearchPlanResponse,
    TableBlock,
    TextBlock,
    VisualBlock,
    json_loads,
)
from app.storage import artifact_url
from app.visual_format import format_visual_observation

_CHECKPOINTER_CONTEXTS: list[Any] = []


@dataclass(frozen=True)
class AgentContext:
    project_id: str
    thread_id: str = ""
    document_ids: list[str] = field(default_factory=list)


@dataclass
class Evidence:
    text: str
    citation: CitationRead
    score: int = 0


class CompactEvidence(BaseModel):
    evidence_id: str
    document_id: str
    document_name: str
    page_number: int
    source_kind: str
    source_id: str = ""
    label: str
    snippet: str = ""
    table_markdown: str = ""
    visual_summary: str = ""
    data: dict[str, Any] = {}
    artifact_url: str | None = None
    bbox_json: str = "[]"
    confidence: float = 0.7
    extraction_method: str = ""


class SearchCorpusArgs(BaseModel):
    query: str = Field(description="Question or keyword query to search across uploaded report text.")
    limit: int = Field(default=8, ge=1, le=20, description="Maximum number of compact evidence snippets to return.")


class PageContextArgs(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(default="", validation_alias=AliasChoices("document_id", "doc_id"), description="Uploaded document ID.")
    page_number: int = Field(default=1, validation_alias=AliasChoices("page_number", "page"), description="One-based page number to inspect.")


class TableLookupArgs(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(default="", validation_alias=AliasChoices("document_id", "doc_id"), description="Uploaded document ID.")
    page_number: int | None = Field(default=None, validation_alias=AliasChoices("page_number", "page"), description="Optional one-based page number.")
    table_id: str | None = Field(default=None, validation_alias=AliasChoices("table_id", "id"), description="Optional exact table evidence ID.")


class VisualLookupArgs(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_id: str = Field(default="", validation_alias=AliasChoices("document_id", "doc_id"), description="Uploaded document ID.")
    page_number: int | None = Field(default=None, validation_alias=AliasChoices("page_number", "page"), description="Optional one-based page number.")
    visual_id: str | None = Field(default=None, validation_alias=AliasChoices("visual_id", "id"), description="Optional exact Cosmos visual evidence ID.")


class CompareKPIArgs(BaseModel):
    metric: str = Field(description="KPI name such as revenue, operating margin, EPS, EBITDA, or regional revenue.")
    period: str | None = Field(default=None, description="Optional period filter.")


class ChartTableVerifyArgs(BaseModel):
    query: str = Field(description="The chart/table verification question to answer.")


class MarginBridgeArgs(BaseModel):
    metric: str = Field(default="operating margin", description="Margin metric to bridge, usually operating margin.")


class DocumentInventoryArgs(BaseModel):
    include_evidence_counts: bool = Field(default=True, description="Include text/table/Cosmos/KPI evidence counts for each document.")


class ModelUnavailableError(RuntimeError):
    """Raised when the AI-only chat runtime cannot call the configured model."""


FINANCIAL_AGENT_SYSTEM_PROMPT = """You are a multimodal financial report analyst.

Only answer finance, accounting, company-performance, valuation, investor-relations, reporting, KPI,
forecasting, and strategy questions. Politely refuse unrelated topics and steer back to financial analysis.
Use uploaded document tools for company-specific facts, KPIs, tables, and citations. Do not use live web,
market data, or outside sources for factual claims. Use general finance knowledge to explain possible
drivers, propose follow-up analyses, critique assumptions, or suggest decision angles, but label that as
analyst inference or suggested next steps rather than document evidence.
Treat uploaded screenshots and image files as visual evidence. If Cosmos visual observations exist, use
`search_corpus` and `get_visual` to answer what the image shows. Do not call image evidence "missing OCR"
when a visual observation or rendered page citation is available; say OCR text is absent only if relevant.
Prefer compact evidence tools over broad page context. Call page/table/visual tools when a citation
needs inspection. Use `agent_document_inventory` first for questions about uploaded documents,
covered periods, available evidence, or workspace contents. Delegate narrow work with the `task` tool when useful:
- use `kpi-analyst` for margin bridges, regional growth, KPI comparisons, and arithmetic checks
- use `visual-auditor` for chart/table agreement, page visual observations, and infographic checks
- use `filing-synthesizer` for document coverage, report summaries, management-stated causes, and cross-document narrative
- use `risk-strategy-analyst` for investment framing, strategic risks, follow-up diligence, and labeled analyst inference

Separate:
- management-stated causes: explicit wording from the company
- arithmetic facts: KPI, margin, growth, and bridge calculations
- inference: your reasoned interpretation when direct management wording is absent

Every final answer must include page, table, chart, or visual references when evidence exists. If the
uploaded documents do not directly support an answer, still be helpful: summarize what is supported,
state what is missing, and give practical next analytical steps.
When the user explicitly asks you to build, create, draft, prepare, or produce an analyst deliverable,
produce the deliverable in that response. Do not reply with a status update or ask for confirmation."""

NO_DOCUMENT_SYSTEM_PROMPT = """You are a finance-only analyst assistant for a local financial report workspace.

The workspace has no uploaded evidence yet. You may answer general finance, accounting, KPI, valuation,
investor-relations, financial-statement, and strategy-analysis questions from general financial knowledge.
Do not make company-specific or document-specific claims. Do not use live web or market data. Encourage
the user to upload annual reports, earnings PDFs, investor decks, spreadsheets, screenshots, or images when
they want grounded evidence with citations. Politely refuse non-finance topics."""

KPI_SUBAGENT_PROMPT = """You are a KPI analyst for uploaded financial reports.
Use only KPI, corpus, and margin-bridge tools. Return concise arithmetic facts with document/page citations.
Do not infer causes unless source text explicitly supports them."""

VISUAL_SUBAGENT_PROMPT = """You are a visual evidence auditor for uploaded financial reports.
Use only page, table, visual, and chart-verification tools. Compare chart observations against extracted
tables when possible. Flag uncertainty and cite document/page/table/visual IDs."""

FILING_SYNTHESIS_SUBAGENT_PROMPT = """You are a filing synthesis analyst for uploaded financial reports.
Use only document inventory, corpus, page, table, and visual tools. Identify which documents and periods are covered, summarize
management-stated explanations, and connect evidence across reports. Keep citations attached to every
company-specific claim."""

RISK_STRATEGY_SUBAGENT_PROMPT = """You are a financial risk and strategy analyst.
Use corpus, KPI, and margin tools to frame evidence-backed implications, investment diligence questions,
strategic risks, and scenario angles. Clearly label analyst inference and never present live web or market
data as evidence."""


def _document_name(session: Session, document_id: str) -> str:
    document = session.get(Document, document_id)
    return document.filename if document else "Unknown document"


def _citation(session: Session, document_id: str, page_number: int, source_kind: str, source_id: str = "", label: str = "") -> CitationRead:
    image_url = None
    bbox_json = "[]"
    confidence = 0.7
    page = session.exec(select(Page).where(Page.document_id == document_id, Page.page_number == page_number)).first()
    if page:
        image_url = artifact_url(page.image_path)
    if source_kind == "table" and source_id:
        table = session.get(TableBlock, source_id)
        if table:
            bbox_json = table.bbox_json
            confidence = table.confidence
    elif source_kind == "visual" and source_id:
        visual = session.get(VisualBlock, source_id)
        if visual:
            bbox_json = visual.bbox_json
            confidence = visual.confidence
            image_url = artifact_url(visual.image_path) or image_url
    return CitationRead(
        document_id=document_id,
        document_name=_document_name(session, document_id),
        page_number=page_number,
        source_kind=source_kind,
        source_id=source_id,
        label=label or f"{source_kind} on page {page_number}",
        artifact_url=image_url,
        bbox_json=bbox_json,
        confidence=confidence,
    )


def _allowed_document_ids(session: Session, project_id: str, document_ids: list[str] | None = None) -> set[str]:
    statement = select(Document).where(Document.project_id == project_id)
    if document_ids:
        statement = statement.where(col(Document.id).in_(set(document_ids)))
    documents = session.exec(statement).all()
    return {document.id for document in documents}


def search_corpus(project_id: str, query: str, limit: int = 8, document_ids: list[str] | None = None) -> list[Evidence]:
    terms = [term.lower() for term in re.findall(r"[A-Za-z][A-Za-z0-9%-]+", query) if len(term) > 2]
    target_terms = _target_terms(query)
    lowered_query = query.lower()
    visual_intent = _has_visual_intent(query)
    with Session(engine) as session:
        doc_ids = _allowed_document_ids(session, project_id, document_ids)
        documents = session.exec(select(Document).where(col(Document.id).in_(doc_ids))).all() if doc_ids else []
        document_names = {document.id: document.filename for document in documents}
        image_doc_ids = {
            document.id
            for document in documents
            if any(token in document.filename.lower() for token in ("screenshot", ".png", ".jpg", ".jpeg", ".webp", "image"))
            or document.content_type.startswith("image/")
        }
        named_doc_ids = {document.id for document in documents if document.filename.lower() in lowered_query}
        if named_doc_ids:
            doc_ids = named_doc_ids
        elif visual_intent and image_doc_ids and _is_direct_attachment_question(query) and len(image_doc_ids) == 1:
            doc_ids = image_doc_ids
        pages = session.exec(select(Page).where(col(Page.document_id).in_(doc_ids))).all() if doc_ids else []
        text_blocks = session.exec(select(TextBlock).where(col(TextBlock.document_id).in_(doc_ids))).all() if doc_ids else []
        tables = session.exec(select(TableBlock).where(col(TableBlock.document_id).in_(doc_ids))).all() if doc_ids else []
        visuals = session.exec(select(VisualBlock).where(col(VisualBlock.document_id).in_(doc_ids))).all() if doc_ids else []
        scored: list[tuple[int, Evidence]] = []

        def score_text(value: str, document_id: str = "", source_kind: str = "") -> int:
            haystack = f"{document_names.get(document_id, '')} {value}".lower()
            document_name = document_names.get(document_id, "").lower()
            score = sum(haystack.count(term) for term in terms)
            for term in target_terms:
                if term in haystack:
                    score += 28
                if term in document_name:
                    score += 80
            if visual_intent and source_kind == "visual":
                score += 14
                score += _financial_visual_relevance(haystack, lowered_query)
            if source_kind in {"page", "text"} and _is_visual_reading_question(query):
                score -= 70
            if visual_intent and document_id in image_doc_ids and _is_direct_attachment_question(query):
                score += 20
            if _is_investment_decision_question(query) and document_id in image_doc_ids and not any(term in haystack for term in target_terms):
                score -= 80
            return score

        for page in pages:
            score = score_text(page.text, page.document_id, "page")
            if score:
                snippet = _snippet(page.text, terms) if page.text.strip() else "Rendered page artifact available for visual inspection."
                scored.append((score, Evidence(snippet, _citation(session, page.document_id, page.page_number, "page", page.id, "page evidence"), score)))
        for block in text_blocks:
            score = score_text(block.text, block.document_id, "text")
            if score:
                scored.append((score, Evidence(_snippet(block.text, terms), _citation(session, block.document_id, block.page_number, "text", block.id, "text evidence"), score)))
        for table in tables:
            score = score_text(table.table_markdown, table.document_id, "table")
            if score:
                scored.append((score, Evidence(_table_preview(table.table_markdown), _citation(session, table.document_id, table.page_number, "table", table.id, "table evidence"), score)))
        for visual in visuals:
            formatted_visual = format_visual_observation(visual)
            visual_text = f"{visual.title}\n{visual.kind}\n{formatted_visual}"
            score = score_text(visual_text, visual.document_id, "visual")
            if visual_intent and visual.image_path:
                score += 4
            if score:
                snippet = formatted_visual or "Cosmos visual observation is available for this image/page."
                scored.append((score, Evidence(snippet, _citation(session, visual.document_id, visual.page_number, "visual", visual.id, visual.title or "visual evidence"), score)))
        scored.sort(key=lambda item: item[0], reverse=True)
        if not scored and visual_intent:
            for visual in visuals[:limit]:
                snippet = format_visual_observation(visual) or "Cosmos visual observation is available for this image/page."
                scored.append((1, Evidence(snippet, _citation(session, visual.document_id, visual.page_number, "visual", visual.id, visual.title or "visual evidence"), 1)))
        return [item for _, item in scored[:limit]]


def document_inventory(project_id: str, document_ids: list[str] | None = None, include_evidence_counts: bool = True) -> dict[str, Any]:
    with Session(engine) as session:
        allowed_ids = _allowed_document_ids(session, project_id, document_ids)
        documents = session.exec(select(Document).where(col(Document.id).in_(allowed_ids)).order_by(Document.created_at)).all() if allowed_ids else []
        brief = get_workspace_brief(project_id) if not document_ids else None
        items: list[dict[str, Any]] = []
        for document in documents:
            kpis = session.exec(select(KPIRecord).where(KPIRecord.document_id == document.id)).all()
            periods = sorted({kpi.period for kpi in kpis if kpi.period})
            first_page = session.exec(select(Page).where(Page.document_id == document.id).order_by(Page.page_number)).first()
            item: dict[str, Any] = {
                "document_id": document.id,
                "document_name": document.filename,
                "status": document.status,
                "page_count": document.page_count,
                "covered_periods_from_kpis": periods[:12],
                "summary": _truncate(document.summary, 900),
                "first_page_citation": _citation(session, document.id, first_page.page_number if first_page else 1, "page", first_page.id if first_page else "", "document first page").model_dump(),
            }
            if include_evidence_counts:
                item["evidence_counts"] = {
                    "text_blocks": len(session.exec(select(TextBlock).where(TextBlock.document_id == document.id)).all()),
                    "tables": len(session.exec(select(TableBlock).where(TableBlock.document_id == document.id)).all()),
                    "cosmos_visuals": len(session.exec(select(VisualBlock).where(VisualBlock.document_id == document.id)).all()),
                    "kpis": len(kpis),
                    "cosmos_pages_analyzed": document.vision_pages_analyzed,
                    "cosmos_pages_possible": document.vision_pages_possible,
                    "vision_coverage": document.vision_coverage,
                }
            items.append(item)
        return {
            "project_id": project_id,
            "document_count": len(items),
            "workspace_periods": brief.periods if brief else [],
            "workspace_companies": brief.companies if brief else [],
            "documents": items,
        }


def get_page_context(document_id: str, page_number: int, max_chars: int = 2400) -> dict[str, Any]:
    with Session(engine) as session:
        page = session.exec(select(Page).where(Page.document_id == document_id, Page.page_number == page_number)).first()
        tables = session.exec(select(TableBlock).where(TableBlock.document_id == document_id, TableBlock.page_number == page_number)).all()
        visuals = session.exec(select(VisualBlock).where(VisualBlock.document_id == document_id, VisualBlock.page_number == page_number)).all()
        return {
            "page": _compact_page(session, page, max_chars) if page else None,
            "tables": [_compact_table(session, table) for table in tables],
            "visuals": [_compact_visual(session, visual) for visual in visuals],
        }


def get_table(document_id: str, page_number: int | None = None, table_id: str | None = None) -> dict[str, Any]:
    with Session(engine) as session:
        if table_id:
            table = session.get(TableBlock, table_id)
            return _compact_table(session, table).model_dump() if table else {"error": "table not found"}
        statement = select(TableBlock).where(TableBlock.document_id == document_id)
        if page_number is not None:
            statement = statement.where(TableBlock.page_number == page_number)
        tables = session.exec(statement).all()
        return {"tables": [_compact_table(session, table).model_dump() for table in tables[:6]]}


def get_visual(document_id: str, page_number: int | None = None, visual_id: str | None = None) -> dict[str, Any]:
    with Session(engine) as session:
        if visual_id:
            visual = session.get(VisualBlock, visual_id)
            return _compact_visual(session, visual).model_dump() if visual else {"error": "visual not found"}
        statement = select(VisualBlock).where(VisualBlock.document_id == document_id)
        if page_number is not None:
            statement = statement.where(VisualBlock.page_number == page_number)
        visuals = session.exec(statement).all()
        return {"visuals": [_compact_visual(session, visual).model_dump() for visual in visuals[:6]]}


def compare_kpi(project_id: str, metric: str, document_ids: list[str] | None = None, period: str | None = None) -> CompareResponse:
    normalized = normalize_metric(metric)
    with Session(engine) as session:
        allowed = _allowed_document_ids(session, project_id, document_ids)
        statement = select(KPIRecord).where(KPIRecord.metric == normalized, col(KPIRecord.document_id).in_(allowed))
        if period:
            statement = statement.where(KPIRecord.period == period)
        records = session.exec(statement).all()
        points = [
            ComparePoint(
                document_id=record.document_id,
                document_name=_document_name(session, record.document_id),
                metric=record.metric,
                period=record.period,
                value=record.value,
                unit=record.unit,
                segment=record.segment,
                page_number=record.page_number,
                source_text=record.source_text,
            )
            for record in records
        ]
        points.sort(key=lambda point: (point.document_name, point.period, point.segment))
        return CompareResponse(metric=normalized, points=points)


def verify_chart_against_table(project_id: str, query: str, document_ids: list[str] | None = None) -> tuple[str, list[CitationRead]]:
    with Session(engine) as session:
        doc_ids = _allowed_document_ids(session, project_id, document_ids)
        if not doc_ids:
            return "No ready documents are available yet.", []
        visuals = [
            visual
            for visual in session.exec(select(VisualBlock).where(col(VisualBlock.document_id).in_(doc_ids))).all()
            if visual.extraction_method == "cosmos" and "not configured" not in visual.summary.lower()
        ]
        tables = session.exec(select(TableBlock).where(col(TableBlock.document_id).in_(doc_ids))).all()
        citations: list[CitationRead] = []
        parts: list[str] = []
        for visual in visuals[:4]:
            observation = json_loads(visual.data_json, {})
            conflicts = observation.get("chart_table_conflicts") or []
            citations.append(_citation(session, visual.document_id, visual.page_number, "visual", visual.id, visual.title or "visual evidence"))
            parts.append(
                f"Visual p.{visual.page_number}: {visual.summary[:500]}"
                + (f"\nPotential conflicts: {'; '.join(conflicts[:3])}" if conflicts else "")
            )
        for table in tables[:4]:
            citations.append(_citation(session, table.document_id, table.page_number, "table", table.id, "table evidence"))
            parts.append(f"Table p.{table.page_number}: {_table_preview(table.table_markdown)}")
        if not visuals and tables:
            return (
                "I found extracted tables, but I do not have Cosmos visual observations for charts in this project yet. "
                "So I cannot honestly say whether a chart agrees with the table. Set `NEBIUS_API_KEY`, keep "
                "`FRA_ENABLE_MODEL_CALLS=1`, re-upload the document, then ask again. Available table evidence:\n\n"
                + "\n\n".join(parts[:4]),
                citations,
            )
        if not parts:
            return "I found no extracted charts or tables to compare yet.", citations
        return "Chart-table verification evidence:\n\n" + "\n\n".join(parts), citations


def calculate_margin_bridge(project_id: str, metric: str = "operating margin", document_ids: list[str] | None = None) -> tuple[str, list[CitationRead]]:
    comparison = compare_kpi(project_id, metric, document_ids=document_ids)
    citations: list[CitationRead] = []
    with Session(engine) as session:
        for point in comparison.points:
            citations.append(_citation(session, point.document_id, point.page_number, "kpi", "", point.metric))
    if len(comparison.points) < 2:
        return f"I found fewer than two `{comparison.metric}` observations, so I cannot calculate a period bridge yet.", citations
    ordered = comparison.points[:]
    changes = []
    for previous, current in zip(ordered, ordered[1:]):
        change = delta(current.value, previous.value)
        growth = growth_rate(current.value, previous.value)
        growth_text = f", {growth:.1f}% relative change" if growth is not None else ""
        changes.append(
            f"{previous.document_name} {previous.period or 'period'} to {current.document_name} {current.period or 'period'}: {change:+.1f}{current.unit}{growth_text}."
        )
    return "\n".join(changes), citations


RESEARCH_PLAN_SYSTEM_PROMPT = """You are Nemotron planning a financial report research run before a LangChain Deep Agent executes.
Create a concise, useful plan for the human to approve once.

Rules:
- Return only valid JSON.
- Do not answer the user's finance question yet.
- Ground the plan in the available workspace brief and uploaded evidence inventory.
- Choose only tools that are useful for this request.
- Valid tools: search_corpus, get_page_context, get_table, get_visual, compare_kpi, verify_chart_against_table, calculate_margin_bridge, document_inventory.
- Valid subagents: kpi-analyst, visual-auditor, filing-synthesizer, risk-strategy-analyst.
- Keep arrays short and analyst-readable.
- If uploaded evidence is missing for the user's request, include that in evidence_needed.
- Guardrails should mention no live web/market data and no personalized financial advice when relevant.

JSON schema:
{
  "summary": "one sentence describing the planned research run",
  "steps": ["3-6 concrete steps"],
  "tools": ["tool names"],
  "subagents": ["subagent names"],
  "evidence_needed": ["evidence to inspect or missing evidence"],
  "output_format": ["sections the final answer should contain"],
  "guardrails": ["limits and safety notes"],
  "confidence": "low|medium|high"
}
"""


def generate_research_plan(project_id: str, question: str, attachments: list[str] | None = None) -> ResearchPlanResponse:
    if not settings.enable_model_calls:
        raise ModelUnavailableError("AI model calls are disabled. Set `FRA_ENABLE_MODEL_CALLS=1` and restart the backend.")
    if not settings.nebius_api_key:
        raise ModelUnavailableError("Nebius API key is required. Set `NEBIUS_API_KEY` in `backend/.env` and restart the backend.")
    workspace_brief = _project_brief(project_id)
    prompt = (
        f"Workspace evidence brief:\n{workspace_brief or 'No uploaded evidence is ready yet.'}\n\n"
        f"User question:\n{question}\n\n"
        f"New attachments named by the user, if any:\n{', '.join(attachments or []) or 'none'}"
    )
    try:
        response = _reasoning_model().invoke(
            [
                {"role": "system", "content": RESEARCH_PLAN_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ]
        )
        content = str(getattr(response, "content", None) or response)
        raw = json.loads(_extract_json_object(content))
        plan = ResearchPlanResponse.model_validate(raw)
        return _normalize_research_plan(plan)
    except Exception as exc:
        raise ModelUnavailableError(f"Nemotron research plan failed: {exc}") from exc


def _normalize_research_plan(plan: ResearchPlanResponse) -> ResearchPlanResponse:
    valid_tools = {
        "search_corpus",
        "get_page_context",
        "get_table",
        "get_visual",
        "compare_kpi",
        "verify_chart_against_table",
        "calculate_margin_bridge",
        "document_inventory",
    }
    valid_subagents = {"kpi-analyst", "visual-auditor", "filing-synthesizer", "risk-strategy-analyst"}
    plan.tools = [tool for tool in _clean_plan_items(plan.tools, 8) if tool in valid_tools]
    plan.subagents = [subagent for subagent in _clean_plan_items(plan.subagents, 4) if subagent in valid_subagents]
    plan.steps = _clean_plan_items(plan.steps, 6)
    plan.evidence_needed = _clean_plan_items(plan.evidence_needed, 6)
    plan.output_format = _clean_plan_items(plan.output_format, 6)
    plan.guardrails = _clean_plan_items(plan.guardrails, 4)
    if plan.confidence not in {"low", "medium", "high"}:
        plan.confidence = "medium"
    if not plan.summary.strip():
        raise ValueError("research plan summary is empty")
    if not plan.steps:
        raise ValueError("research plan steps are empty")
    return plan


def _clean_plan_items(items: list[str], limit: int) -> list[str]:
    cleaned: list[str] = []
    for item in items:
        text = _truncate(str(item).strip(), 220)
        if text and text not in cleaned:
            cleaned.append(text)
        if len(cleaned) >= limit:
            break
    return cleaned


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


def answer_question(project_id: str, question: str, thread_id: str | None = None, human_review: bool = False) -> ChatResponse:
    if _ready_document_count(project_id) == 0:
        answer = _answer_without_documents(question)
        return _persist_answer(project_id, question, answer, [], thread_id)
    if _is_greeting(question):
        answer = _answer_with_documents_greeting(project_id)
        return _persist_answer(project_id, question, answer, [], thread_id)
    if _is_low_signal_prompt(question):
        answer = _clarify_low_signal_prompt(project_id)
        return _persist_answer(project_id, question, answer, [], thread_id)

    effective_question = _deep_agent_question(project_id, question, thread_id)
    if human_review:
        model_response = _try_deep_agent(AgentContext(project_id=project_id, thread_id=thread_id or project_id), effective_question, human_review=True)
        if model_response:
            if model_response[3]:
                return ChatResponse(
                    thread_id=thread_id or project_id,
                    answer=model_response[0],
                    citations=model_response[1],
                    structured_answer=model_response[2],
                    interrupted=True,
                    review_actions=model_response[4],
                )
            return _persist_answer(project_id, question, model_response[0], model_response[1], thread_id, model_response[2])
        raise ModelUnavailableError("Nemotron Deep Agent did not return a human-review answer. Check the Nebius API key, model access, and backend logs.")
    model_response = _try_deep_agent(AgentContext(project_id=project_id, thread_id=thread_id or project_id), effective_question, human_review)
    if model_response:
        if model_response[3]:
            return ChatResponse(
                thread_id=thread_id or project_id,
                answer=model_response[0],
                citations=model_response[1],
                structured_answer=model_response[2],
                interrupted=True,
                review_actions=model_response[4],
            )
        return _persist_answer(project_id, question, model_response[0], model_response[1], thread_id, model_response[2])
    raise ModelUnavailableError("Nemotron Deep Agent did not return an answer. Check the Nebius API key, model access, and backend logs.")


def _deep_agent_question(project_id: str, question: str, thread_id: str | None) -> str:
    effective_question = question
    if _is_followup_build_confirmation(question):
        previous_question = _last_deliverable_question(project_id, thread_id)
        if previous_question:
            effective_question = _force_deliverable_question(previous_question)
    if (_is_affirmative(effective_question) or _is_investment_followup_consent(effective_question)) and _last_answer_requested_investment_scope(project_id, thread_id):
        target = _last_investment_target(project_id, thread_id)
        target_clause = f" for {target}" if target else ""
        effective_question = (
            f"Provide an evidence-based investment analysis{target_clause} using the uploaded documents plus general finance knowledge. "
            "Do not give personalized financial advice or use live market data. Cover business quality, growth, margins, "
            "cash flow, risks, valuation questions to investigate, and what additional evidence would be needed."
        )
    return effective_question


def _answer_without_documents(question: str) -> str:
    if _is_greeting(question):
        return (
            "Hi. I am a finance-focused Deep Agent for report analysis. Upload annual reports, earnings PDFs, "
            "investor decks, spreadsheets, screenshots, or chart images when you want cited evidence. You can also "
            "ask general finance questions now, and I will keep company-specific claims out until evidence is uploaded."
        )
    if _needs_uploaded_evidence(question):
        return (
            "No source documents are uploaded in this workspace yet, so I cannot cite pages or identify report periods. "
            "Upload annual reports, earnings PDFs, investor decks, spreadsheets, screenshots, or chart images, and I can summarize the documents, "
            "identify covered periods, compare KPIs, and cite the exact pages/tables/visuals. "
            "For chart-table checks, I will extract chart values, extract source-table values, align periods and units, then flag mismatches or uncertainty."
        )
    if not settings.enable_model_calls:
        raise ModelUnavailableError("AI model calls are disabled. Set `FRA_ENABLE_MODEL_CALLS=1` and restart the backend.")
    if not settings.nebius_api_key:
        raise ModelUnavailableError("Nebius API key is required. Set `NEBIUS_API_KEY` in `backend/.env` and restart the backend.")
    model = _reasoning_model()
    response = model.invoke(
        [
            {"role": "system", "content": NO_DOCUMENT_SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ]
    )
    return str(getattr(response, "content", None) or response).strip()


def _answer_with_documents_greeting(project_id: str) -> str:
    ready_count = _ready_document_count(project_id)
    brief = get_workspace_brief(project_id)
    company_text = ""
    if brief and brief.companies:
        company_text = f" I found evidence for {', '.join(brief.companies[:3])}."
    return (
        f"Hi. I finished reading {ready_count} uploaded evidence file{'' if ready_count == 1 else 's'}."
        f"{company_text} What would you like me to investigate first? I can explain margin changes, compare KPIs, "
        "verify whether charts agree with tables, summarize document periods, or build an evidence-based finance view with citations."
    )


def _answer_document_inventory(project_id: str) -> tuple[str, list[CitationRead]]:
    inventory = document_inventory(project_id, include_evidence_counts=True)
    documents = inventory.get("documents", [])
    if not documents:
        return "No uploaded documents are ready in this workspace yet.", []
    lines = ["Uploaded documents and covered periods:"]
    citations: list[CitationRead] = []
    for index, document in enumerate(documents, start=1):
        name = str(document.get("document_name") or "Document")
        page_count = int(document.get("page_count") or 0)
        periods = document.get("covered_periods_from_kpis") or _periods_from_summary(str(document.get("summary") or ""))
        period_text = "; ".join(str(period) for period in periods[:4]) if periods else "period not identified yet"
        counts = document.get("evidence_counts") or {}
        citation_payload = document.get("first_page_citation") or {}
        try:
            citation = CitationRead.model_validate(citation_payload)
            citations.append(citation)
            cite_text = f"{citation.document_name} p.{citation.page_number}"
        except Exception:
            cite_text = "citation unavailable"
        evidence_text = (
            f"{counts.get('text_blocks', 0)} text, {counts.get('tables', 0)} tables, "
            f"{counts.get('cosmos_visuals', 0)} Cosmos visuals, {counts.get('kpis', 0)} KPIs"
        )
        lines.append(f"{index}. {name} ({page_count} pages): {period_text}. Evidence: {evidence_text}. Source: {cite_text}.")
    return "\n".join(lines), _dedupe_citations(citations)


def _document_display_title(document: Document | None, fallback_name: str = "") -> str:
    if document is None:
        return fallback_name or "Uploaded document"
    corpus = f"{document.filename} {document.summary}".lower()
    if "brunswick" in corpus and "q1 2026" in corpus:
        return "Brunswick Q1 2026 Earnings Slides"
    if "brunswick" in corpus:
        return "Brunswick earnings materials"
    if "apple" in corpus and "fy26" in corpus and "q2" in corpus:
        return "Apple FY26 Q2 Financial Statements"
    if "apple" in corpus and "fy25" in corpus and "q4" in corpus:
        return "Apple FY25 Q4 Financial Statements"
    if "apple" in corpus:
        return "Apple financial statements"
    clean = re.sub(r"\.(pdf|pptx?|docx?|xlsx?|csv|png|jpe?g)$", "", document.filename, flags=re.I)
    return clean.replace("_", " ").strip() or fallback_name or "Uploaded document"


def _document_company(document: Document | None, fallback_name: str = "") -> str:
    corpus = f"{document.filename if document else ''} {document.summary if document else ''} {fallback_name}".lower()
    if "brunswick" in corpus:
        return "Brunswick Corporation"
    if "apple" in corpus:
        return "Apple Inc."
    if "cisco" in corpus:
        return "Cisco"
    return "Uploaded company"


def _metric_display_name(metric: str) -> str:
    labels = {
        "revenue": "Revenue",
        "gross margin": "Gross margin",
        "operating income": "Operating income",
        "operating margin": "Operating margin",
        "EPS": "EPS",
        "free cash flow": "Free cash flow",
        "net income": "Net income",
    }
    return labels.get(metric, metric.replace("_", " ").title())


def _format_kpi_value(metric: str, value: float, unit: str) -> str:
    unit_clean = unit.strip().lower()
    if metric == "operating margin" or unit_clean in {"%", "percent", "percentage"}:
        return f"{value:.1f}%"
    if unit_clean in {"$m", "$ millions", "$ million", "usd millions", "m", "million", "millions", "$"}:
        sign = "-" if value < 0 else ""
        absolute = abs(value)
        if absolute >= 1000:
            return f"{sign}${absolute / 1000:.1f}B"
        return f"{sign}${absolute:.0f}M"
    if unit_clean in {"$b", "$ billions", "$ billion", "usd billions", "b", "billion", "billions", "bn"}:
        sign = "-" if value < 0 else ""
        return f"{sign}${abs(value):.1f}B"
    if unit_clean:
        return f"{value:g} {unit}"
    return f"{value:g}"


def _metric_change_sentence(metric: str, latest: ComparePoint, prior: ComparePoint, document: Document | None) -> str | None:
    change = delta(latest.value, prior.value)
    growth = growth_rate(latest.value, prior.value)
    if change is None or growth is None:
        return None
    direction = "increased" if change >= 0 else "declined"
    company = _document_company(document, latest.document_name)
    duration = _period_duration(latest.period).replace(" ended", "")
    return (
        f"{company} {duration} {_metric_display_name(metric).lower()} {direction} "
        f"from {_format_kpi_value(metric, prior.value, prior.unit)} to {_format_kpi_value(metric, latest.value, latest.unit)} "
        f"({growth:+.1f}%) in {latest.period}."
    )


def _answer_metric_comparison(project_id: str, question: str) -> tuple[str, list[CitationRead]]:
    lowered = question.lower()
    requested_metrics: list[str] = []
    for label, aliases in (
        ("revenue", ("revenue", "sales", "net sales")),
        ("gross margin", ("gross margin",)),
        ("operating income", ("operating income", "operating profit")),
        ("operating margin", ("operating margin",)),
        ("EPS", ("eps", "earnings per share")),
        ("free cash flow", ("free cash flow", "cash flow")),
        ("net income", ("net income",)),
    ):
        if any(alias in lowered for alias in aliases):
            requested_metrics.append(label)
    if not requested_metrics:
        requested_metrics = ["revenue"]

    document_filter: set[str] | None = None
    with Session(engine) as session:
        documents = session.exec(select(Document).where(Document.project_id == project_id, Document.status == "ready")).all()
        document_by_id = {document.id: document for document in documents}
        if "apple" in lowered:
            document_filter = {document.id for document in documents if "apple" in f"{document.filename} {document.summary}".lower()}
        elif "brunswick" in lowered:
            document_filter = {document.id for document in documents if "brunswick" in f"{document.filename} {document.summary}".lower()}

    scoped_documents = [document for document in documents if not document_filter or document.id in document_filter]
    company_names = sorted({_document_company(document) for document in scoped_documents if document})
    company_label = ", ".join(name for name in company_names if name != "Uploaded company") or "uploaded companies"

    lines = [
        f"{company_label} KPI comparison",
        "",
        "Evidence facts:",
        "| Report / period | " + " | ".join(_metric_display_name(metric) for metric in requested_metrics) + " | Source |",
        "| --- | " + " | ".join("---" for _ in requested_metrics) + " | --- |",
    ]
    citations: list[CitationRead] = []
    rows: dict[tuple[str, str], dict[str, ComparePoint]] = {}
    all_metric_points: dict[str, list[ComparePoint]] = {}
    for metric in requested_metrics:
        comparison = compare_kpi(project_id, metric, document_ids=list(document_filter) if document_filter else None)
        points = [
            point
            for point in comparison.points
            if point.period and (not document_filter or point.document_id in document_filter)
        ]
        if not points:
            all_metric_points[metric] = []
            continue
        points.sort(key=lambda point: (point.document_name, _period_date(point.period) or datetime.min, point.period, point.segment))
        all_metric_points[metric] = points
        for point in points:
            key = (point.document_id, point.period)
            existing = rows.setdefault(key, {})
            if metric not in existing:
                existing[metric] = point

    sorted_rows = sorted(
        rows.items(),
        key=lambda item: (
            _document_display_title(document_by_id.get(item[0][0]), next(iter(item[1].values())).document_name),
            _period_date(item[0][1]) or datetime.min,
            item[0][1],
        ),
    )
    if not sorted_rows:
        return "I could not find normalized KPI records for those metrics in the uploaded evidence yet.", []

    for (document_id, period), metric_points in sorted_rows[:12]:
        document = document_by_id.get(document_id)
        title = _document_display_title(document, next(iter(metric_points.values())).document_name)
        page_numbers = sorted({point.page_number for point in metric_points.values()})
        source = f"p.{', '.join(str(page) for page in page_numbers[:3])}"
        values = [_format_kpi_value(metric, metric_points[metric].value, metric_points[metric].unit) if metric in metric_points else "not extracted" for metric in requested_metrics]
        lines.append(f"| {title}: {period} | " + " | ".join(values) + f" | {source} |")
        with Session(engine) as session:
            for metric, point in metric_points.items():
                citations.append(_citation(session, point.document_id, point.page_number, "kpi", "", metric))

    change_lines: list[str] = []
    for metric, points in all_metric_points.items():
        by_scope: dict[tuple[str, str, str], list[ComparePoint]] = {}
        for point in points:
            by_scope.setdefault((point.document_id, _period_duration(point.period), point.segment), []).append(point)
        for (document_id, _duration, segment), scoped_points in by_scope.items():
            comparable = [point for point in scoped_points if _period_date(point.period)]
            if len(comparable) < 2 or segment:
                continue
            comparable.sort(key=lambda item: _period_date(item.period) or datetime.min)
            sentence = _metric_change_sentence(metric, comparable[-1], comparable[-2], document_by_id.get(document_id))
            if sentence:
                change_lines.append(sentence)

    if change_lines:
        lines.extend(["", "What changed:", *[f"- {line}" for line in change_lines[:6]]])

    lines.extend(
        [
            "",
            "Analyst interpretation:",
            "- Compare like with like: three-month quarters, six-month year-to-date periods, and full fiscal years should not be mixed without normalizing for duration and seasonality.",
            "- Use the table above as extracted evidence. Anything about sustainability, competitive quality, or investment attractiveness is inference unless management states it in the cited materials.",
        ]
    )
    return "\n".join(lines), _dedupe_citations(citations)


def _periods_from_summary(summary: str) -> list[str]:
    patterns = [
        r"Q[1-4]\s*20\d{2}",
        r"FY\d{2,4}\s*Q[1-4]",
        r"Three Months Ended [A-Z][a-z]+ \d{1,2}, \d{4}",
        r"Six Months Ended [A-Z][a-z]+ \d{1,2}, \d{4}",
        r"Twelve Months Ended [A-Z][a-z]+ \d{1,2}, \d{4}",
        r"[A-Z][a-z]+ \d{1,2},\s*\n?20\d{2}",
    ]
    periods: list[str] = []
    for pattern in patterns:
        for match in re.findall(pattern, summary):
            clean = " ".join(str(match).split())
            if clean not in periods:
                periods.append(clean)
    return periods[:6]


def _answer_general_finance(question: str) -> str:
    if not settings.enable_model_calls:
        raise ModelUnavailableError("AI model calls are disabled. Set `FRA_ENABLE_MODEL_CALLS=1` and restart the backend.")
    if not settings.nebius_api_key:
        raise ModelUnavailableError("Nebius API key is required. Set `NEBIUS_API_KEY` in `backend/.env` and restart the backend.")
    model = _reasoning_model()
    response = model.invoke(
        [
            {
                "role": "system",
                "content": NO_DOCUMENT_SYSTEM_PROMPT
                + " The workspace may contain uploaded documents, but the current user question does not ask about them. "
                "Answer from general finance knowledge only and mention that uploaded evidence can be used if they ask document-specific follow-ups.",
            },
            {"role": "user", "content": question},
        ]
    )
    return str(getattr(response, "content", None) or response).strip()


def _is_greeting(question: str) -> bool:
    return bool(re.fullmatch(r"\s*(hi|hello|hey|start|help|what can you do|who are you)[!.?\s]*", question, flags=re.I))


def _is_low_signal_prompt(question: str) -> bool:
    stripped = question.strip()
    if not stripped:
        return True
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9%-]*", stripped.lower())
    if not tokens:
        return True
    meaningful = [token for token in tokens if token not in {"the", "and", "or", "to", "for", "with", "please"}]
    if not meaningful:
        return True
    unique = set(meaningful)
    if len(meaningful) == 1 and meaningful[0] not in {"help", "start"}:
        return True
    if len(meaningful) >= 4 and len(unique) <= 2:
        return True
    if len(stripped) >= 40:
        compact = re.sub(r"\s+", " ", stripped.lower())
        half = len(compact) // 2
        if half > 8 and compact[:half].strip() == compact[half:].strip():
            return True
    return False


def _clarify_low_signal_prompt(project_id: str) -> str:
    ready_count = _ready_document_count(project_id)
    return (
        f"I may have caught an accidental or repeated prompt. I have {ready_count} uploaded evidence "
        f"file{'' if ready_count == 1 else 's'} ready, but I need a clearer finance question before I run the deep report agent.\n\n"
        "Try one of these:\n"
        "- Which KPIs changed the most?\n"
        "- Why did operating margin move?\n"
        "- Compare revenue across the uploaded reports.\n"
        "- Does a chart disagree with a table?"
    )


def _needs_uploaded_evidence(question: str) -> bool:
    lowered = question.lower()
    direct_evidence_phrases = (
        "what documents",
        "which documents",
        "documents are uploaded",
        "uploaded documents",
        "in this workspace",
        "cite page",
        "cite pages",
        "page reference",
        "page references",
        "source page",
        "source pages",
    )
    evidence_terms = ("chart", "table", "figures", "figure", "attached", "uploaded", "screenshot", "slide", "deck", "pdf", "document", "report", "workspace")
    comparison_terms = ("agree", "match", "compare", "verify", "reconcile", "consistent", "same", "cover", "period", "summarize")
    return any(phrase in lowered for phrase in direct_evidence_phrases) or (
        any(term in lowered for term in evidence_terms) and any(term in lowered for term in comparison_terms)
    )


def _is_document_inventory_question(question: str) -> bool:
    lowered = question.lower()
    return any(
        phrase in lowered
        for phrase in (
            "which documents",
            "what documents",
            "which docs",
            "what docs",
            "documents are uploaded",
            "uploaded documents",
            "uploaded docs",
            "what companies",
            "which companies",
            "companies data",
            "company data",
            "companies do we have",
            "company do we have",
            "what company review",
            "which company review",
            "what company did",
            "what company you",
            "what periods",
            "periods do they cover",
            "covered periods",
            "workspace contents",
        )
    )


def _document_inventory_citations(project_id: str, document_ids: list[str] | None = None) -> list[CitationRead]:
    with Session(engine) as session:
        allowed_ids = _allowed_document_ids(session, project_id, document_ids)
        documents = session.exec(select(Document).where(col(Document.id).in_(allowed_ids), Document.status == "ready").order_by(Document.created_at)).all() if allowed_ids else []
        citations: list[CitationRead] = []
        for document in documents:
            page = session.exec(select(Page).where(Page.document_id == document.id).order_by(Page.page_number)).first()
            if page:
                citations.append(_citation(session, document.id, page.page_number, "page", page.id, "document first page"))
        return citations


def _should_use_document_agent(question: str) -> bool:
    lowered = question.lower()
    document_terms = (
        "uploaded",
        "attached",
        "document",
        "doc",
        "docs",
        "report",
        "pdf",
        "ppt",
        "pptx",
        "deck",
        "slide",
        "screenshot",
        "image",
        "chart",
        "table",
        "figures",
        "evidence",
        "data",
        "company",
        "companies",
        "apple",
        "brunswick",
        "china",
        "country",
        "countries",
        "connection",
        "exposure",
        "supply chain",
        "cite",
        "citation",
        "page",
        "kpi",
        "compare",
        "growth",
        "margin",
        "revenue",
        "sales",
        "cash flow",
        "income statement",
        "balance sheet",
    )
    return any(term in lowered for term in document_terms)


def _is_workspace_correction_prompt(question: str) -> bool:
    lowered = question.lower().strip()
    return any(
        phrase in lowered
        for phrase in (
            "you are wrong",
            "you're wrong",
            "that is wrong",
            "that's wrong",
            "not correct",
            "incorrect",
            "files are uploaded",
            "docs are uploaded",
            "documents are uploaded",
            "we have files",
            "we have docs",
        )
    )


def _has_visual_intent(question: str) -> bool:
    lowered = question.lower()
    return any(term in lowered for term in ("attached", "image", "screenshot", "visual", "chart", "figure", "slide", "what is this", "read this"))


def _financial_visual_relevance(haystack: str, query: str) -> int:
    if not any(term in query for term in ("financial", "kpi", "metric", "margin", "revenue", "sales", "eps", "cash flow", "takeaway", "important", "chart", "table", "adjusted results")):
        return 0
    exact_targets = (
        "adjusted results",
        "first quarter 2026 adjusted results",
        "overview of first quarter",
        "overview of first quarter 2026 adjusted results",
    )
    positive_phrases = (
        "financial highlight",
        "net sales",
        "revenue",
        "adjusted eps",
        "eps",
        "operating earnings",
        "operating margin",
        "gross margin",
        "free cash flow",
        "cash flow",
        "yoy",
        "growth",
        "margin",
        "kpi",
        "$",
        "%",
    )
    negative_phrases = (
        "does not contain a chart",
        "does not contain any charts",
        "does not contain a chart, graph, or table",
        "no financial data",
        "no financial metrics",
        "no numerical data",
        "forward-looking statements",
        "product innovation",
        "awards secured",
        "title slide",
    )
    score = 0
    for phrase in exact_targets:
        if phrase in query and phrase in haystack:
            score += 180
    if "adjusted" in query and "results" in query and "adjusted results" in haystack:
        score += 120
    score += sum(12 for phrase in positive_phrases if phrase in haystack)
    score -= sum(28 for phrase in negative_phrases if phrase in haystack)
    if "does not contain" in haystack and any(term in haystack for term in ("chart", "graph", "table")):
        score -= 180
    return score


def _is_direct_attachment_question(question: str) -> bool:
    lowered = question.lower()
    return any(term in lowered for term in ("attached files just uploaded", "attached", "screenshot", "image", "what is this", "read this"))


def _target_terms(question: str) -> list[str]:
    generic = {
        "the",
        "and",
        "for",
        "from",
        "into",
        "onto",
        "with",
        "have",
        "has",
        "had",
        "was",
        "were",
        "are",
        "you",
        "your",
        "give",
        "show",
        "use",
        "cites",
        "cited",
        "please",
        "what",
        "this",
        "that",
        "tell",
        "about",
        "read",
        "image",
        "screenshot",
        "attached",
        "files",
        "uploaded",
        "treat",
        "cosmos",
        "visual",
        "evidence",
        "cite",
        "page",
        "artifact",
        "chart",
        "table",
        "figures",
        "figure",
        "segment",
        "sales",
        "values",
        "highest",
        "which",
        "using",
        "based",
        "analysis",
        "investment",
        "financial",
        "report",
        "reports",
        "document",
        "documents",
    }
    terms = [term.lower() for term in re.findall(r"[A-Za-z][A-Za-z0-9%-]+", question) if len(term) > 3]
    return [term for term in dict.fromkeys(terms) if term not in generic]


def _is_visual_reading_question(question: str) -> bool:
    lowered = question.lower()
    if not _has_visual_intent(question):
        return False
    if any(term in lowered for term in ("agree", "match", "verify", "reconcile", "against table", "figures in the table")):
        return False
    return any(
        term in lowered
        for term in (
            "what is",
            "what's",
            "read the",
            "read this",
            "visual slide",
            "financial takeaway",
            "tell me",
            "which segment",
            "highest",
            "values by segment",
            "what are the values",
            "screenshot",
            "image",
        )
    )


def _is_investment_decision_question(question: str) -> bool:
    lowered = question.lower()
    return any(
        phrase in lowered
        for phrase in (
            "should i invest",
            "should we invest",
            "buy this stock",
            "invest in",
            "x or y",
            "suitable for investment",
            "more suitable",
            "less risk",
            "more profit",
            "more profits",
        )
    ) and any(
        term in lowered for term in ("company", "companies", "stock", "equity", "shares", "invest", "investment", "risk")
    )


def _asks_for_evidence_based_view(question: str) -> bool:
    lowered = question.lower()
    return any(
        phrase in lowered
        for phrase in (
            "based on evidence",
            "based on uploaded",
            "using uploaded",
            "use the documents",
            "decision framework",
            "investment analysis",
            "research",
            "analyze",
            "both company",
            "both companies",
            "less risk",
            "suitable for investment",
        )
    )


def _is_affirmative(question: str) -> bool:
    return bool(re.fullmatch(r"\s*(yes|yeah|yep|sure|ok|okay|please do|go ahead|do it)\s*[.!?]*\s*", question, flags=re.I))


def _is_investment_followup_consent(question: str) -> bool:
    lowered = question.lower()
    return any(term in lowered for term in ("ok", "okay", "yes", "sure", "go ahead", "research", "analyze", "compare")) and any(
        term in lowered for term in ("investment", "invest", "risk", "profit", "company", "companies")
    )


def _is_direct_deliverable_request(question: str) -> bool:
    lowered = question.lower()
    action_terms = ("build", "create", "make", "produce", "draft", "write", "prepare", "generate")
    deliverable_terms = ("framework", "memo", "analysis", "diligence", "view", "thesis", "scorecard", "recommendation")
    evidence_terms = ("files", "documents", "uploaded", "evidence", "reports", "deck", "presentation")
    return (
        any(term in lowered for term in action_terms)
        and any(term in lowered for term in deliverable_terms)
        and (any(term in lowered for term in evidence_terms) or "investment" in lowered)
    )


def _force_deliverable_question(question: str) -> str:
    if "Produce the complete deliverable now." in question:
        return question
    return (
        f"{question}\n\nProduce the complete deliverable now. Do not ask for confirmation or describe that you are building it. "
        "Use uploaded evidence for company-specific facts, include citations, and label analyst inference separately."
    )


def _is_followup_build_confirmation(question: str) -> bool:
    return bool(re.fullmatch(r"\s*(ok|okay|yes|sure|go ahead|please)?\s*(build|create|make|produce|draft|write)\s*(it|that|the framework|the analysis)?[.!?\s]*", question, flags=re.I))


def _is_incomplete_deliverable_answer(question: str, answer: str) -> bool:
    if not _is_direct_deliverable_request(question):
        return False
    lowered = answer.lower().strip()
    if len(answer) < 700 and lowered.startswith(("building ", "i will build", "i can build", "i'll build", "preparing ")):
        return True
    return "framework will synthesize" in lowered and not any(section in lowered for section in ("risks", "valuation", "cash flow", "margin", "recommendation"))


def _last_deliverable_question(project_id: str, thread_id: str | None) -> str:
    if not thread_id:
        return ""
    with Session(engine) as session:
        answers = session.exec(
            select(Answer).where(Answer.project_id == project_id, Answer.thread_id == thread_id).order_by(Answer.created_at.desc())
        ).all()
    for answer in answers[:5]:
        if _is_direct_deliverable_request(answer.question):
            return answer.question
    return ""


def _last_answer_requested_investment_scope(project_id: str, thread_id: str | None) -> bool:
    if not thread_id:
        return False
    with Session(engine) as session:
        answer = session.exec(
            select(Answer).where(Answer.project_id == project_id, Answer.thread_id == thread_id).order_by(Answer.created_at.desc())
        ).first()
    return bool(answer and "evidence-based investment view" in answer.answer.lower())


def _last_investment_target(project_id: str, thread_id: str | None) -> str:
    if not thread_id:
        return ""
    with Session(engine) as session:
        answer = session.exec(
            select(Answer).where(Answer.project_id == project_id, Answer.thread_id == thread_id).order_by(Answer.created_at.desc())
        ).first()
    if not answer:
        return ""
    haystack = f"{answer.question} {answer.answer}".lower()
    for target in ("Cisco", "Apple", "Brunswick"):
        if target.lower() in haystack:
            return target
    return ""


def _try_deep_agent(context: AgentContext, question: str, human_review: bool = False) -> tuple[str, list[CitationRead], AgentAnswer | None, bool, list[dict[str, Any]]] | None:
    if not settings.enable_model_calls:
        raise ModelUnavailableError("AI model calls are disabled. Set `FRA_ENABLE_MODEL_CALLS=1` and restart the backend.")
    if not settings.nebius_api_key:
        raise ModelUnavailableError("Nebius API key is required. Set `NEBIUS_API_KEY` in `backend/.env` and restart the backend.")
    try:
        _set_active_context(context)
        agent = get_financial_agent(human_review)
        workspace_brief = _project_brief(context.project_id, context.document_ids)
        user_content = f"Workspace evidence brief:\n{workspace_brief or 'No workspace brief available.'}\n\nQuestion:\n{question}"
        result = agent.invoke(
            {"messages": [{"role": "user", "content": user_content}]},
            config={"configurable": {"thread_id": context.thread_id or context.project_id}},
            context=context,
            version="v2",
        )
        interrupts = _extract_interrupt_actions(result)
        if interrupts:
            return (
                "Controlled review is active. The Deep Agent found evidence tool calls it wants to run; approve them to continue, "
                "or reject them to keep the answer from using those tools."
            ), [], None, True, interrupts
        result_dict = _result_value(result)
        structured = _extract_structured_answer(result_dict)
        if structured:
            answer = _format_agent_answer(structured)
            citations = _citations_from_agent_answer(structured)
            if not citations:
                citations = [item.citation for item in search_corpus(context.project_id, question, limit=5, document_ids=context.document_ids)]
            if _is_incomplete_deliverable_answer(question, answer):
                evidence = search_corpus(context.project_id, question, limit=8, document_ids=context.document_ids)
                retry_answer, retry_citations = _synthesize_final_answer(context, _force_deliverable_question(question), answer, evidence)
                return retry_answer, _dedupe_citations(retry_citations + citations), None, False, []
            if _is_document_inventory_question(question):
                citations = _dedupe_citations(citations + _document_inventory_citations(context.project_id, context.document_ids))
            return answer, citations, structured, False, []
        message = result_dict.get("messages", [])[-1]
        content = getattr(message, "content", None) or str(message)
        evidence = search_corpus(context.project_id, question, limit=5, document_ids=context.document_ids)
        synthesized = _synthesize_final_answer(context, question, str(content), evidence)
        citations = synthesized[1]
        if _is_document_inventory_question(question):
            citations = _dedupe_citations(citations + _document_inventory_citations(context.project_id, context.document_ids))
        return synthesized[0], citations, None, False, []
    except ModelUnavailableError:
        raise
    except Exception as exc:
        raise ModelUnavailableError(f"Nemotron Deep Agent call failed: {exc}") from exc


def resume_human_review(project_id: str, thread_id: str, decisions: list[HumanReviewDecision]) -> ChatResponse:
    if not settings.enable_model_calls:
        raise ModelUnavailableError("AI model calls are disabled. Set `FRA_ENABLE_MODEL_CALLS=1` and restart the backend.")
    if not settings.nebius_api_key:
        raise ModelUnavailableError("Nebius API key is required. Set `NEBIUS_API_KEY` in `backend/.env` and restart the backend.")
    try:
        from langgraph.types import Command

        context = AgentContext(project_id=project_id, thread_id=thread_id)
        _set_active_context(context)
        agent = get_financial_agent(True)
        result = agent.invoke(
            Command(resume={"decisions": [decision.model_dump(exclude_none=True) for decision in decisions]}),
            config={"configurable": {"thread_id": thread_id}},
            context=context,
            version="v2",
        )
        interrupts = _extract_interrupt_actions(result)
        if interrupts:
            return ChatResponse(
                thread_id=thread_id,
                answer="Another human review step is required before analysis can continue.",
                citations=[],
                interrupted=True,
                review_actions=interrupts,
            )
        structured = _extract_structured_answer(_result_value(result))
        if structured:
            answer = _format_agent_answer(structured)
            citations = _citations_from_agent_answer(structured)
            return _persist_answer(project_id, "Human review resumed", answer, citations, thread_id, structured)
        result_dict = _result_value(result)
        message = result_dict.get("messages", [])[-1] if result_dict.get("messages") else None
        answer = str(getattr(message, "content", None) or message or "Human-reviewed analysis completed.")
        return _persist_answer(project_id, "Human review resumed", answer, [], thread_id)
    except ModelUnavailableError:
        raise
    except Exception as exc:
        raise ModelUnavailableError(f"Nemotron Deep Agent human-review resume failed: {exc}") from exc


def stream_chat_response(project_id: str, question: str, thread_id: str | None = None, human_review: bool = False) -> Any:
    if _ready_document_count(project_id) == 0:
        yield {"type": "main", "message": "No uploaded evidence yet; answering in finance-only mode."}
        response = answer_question(project_id, question, thread_id, human_review)
        yield {"type": "final", "response": response.model_dump(mode="json")}
        yield {"type": "done"}
        return

    if _is_greeting(question) or _is_low_signal_prompt(question):
        response = answer_question(project_id, question, thread_id, human_review)
        yield {"type": "final", "response": response.model_dump(mode="json")}
        yield {"type": "done"}
        return

    effective_question = _deep_agent_question(project_id, question, thread_id)

    if human_review:
        yield from _stream_deep_agent_response(project_id, effective_question, thread_id, human_review=True)
        return

    yield from _stream_deep_agent_response(project_id, effective_question, thread_id, human_review)


def stream_agent_updates(project_id: str, question: str, thread_id: str | None = None) -> Any:
    if _ready_document_count(project_id) == 0:
        yield {"type": "main", "message": "No uploaded evidence yet; using finance-only chat mode."}
        yield {"type": "done"}
        return
    if not settings.enable_model_calls or not settings.nebius_api_key:
        yield {"type": "error", "message": "Nebius model calls are not configured."}
        return
    context = AgentContext(project_id=project_id, thread_id=thread_id or project_id)
    _set_active_context(context)
    agent = get_financial_agent(False)
    workspace_brief = _project_brief(context.project_id, context.document_ids)
    for chunk in agent.stream(
        {"messages": [{"role": "user", "content": f"Workspace evidence brief:\n{workspace_brief or 'No workspace brief available.'}\n\nQuestion:\n{question}"}]},
        config={"configurable": {"thread_id": f"stream-{context.thread_id or context.project_id}"}},
        context=context,
        stream_mode="updates",
        subgraphs=True,
        version="v2",
    ):
        yield _stream_event(chunk)
    yield {"type": "done"}


def _stream_deep_agent_response(project_id: str, question: str, thread_id: str | None = None, human_review: bool = False) -> Any:
    if not settings.enable_model_calls:
        raise ModelUnavailableError("AI model calls are disabled. Set `FRA_ENABLE_MODEL_CALLS=1` and restart the backend.")
    if not settings.nebius_api_key:
        raise ModelUnavailableError("Nebius API key is required. Set `NEBIUS_API_KEY` in `backend/.env` and restart the backend.")

    context = AgentContext(project_id=project_id, thread_id=thread_id or project_id)
    _set_active_context(context)
    agent = get_financial_agent(human_review)
    workspace_brief = _project_brief(context.project_id, context.document_ids)
    user_content = f"Workspace evidence brief:\n{workspace_brief or 'No workspace brief available.'}\n\nQuestion:\n{question}"
    last_values: dict[str, Any] = {}
    for chunk in agent.stream(
        {"messages": [{"role": "user", "content": user_content}]},
        config={"configurable": {"thread_id": context.thread_id or context.project_id}},
        context=context,
        stream_mode=["updates", "messages", "values"],
        subgraphs=True,
        version="v2",
    ):
        chunk_type = chunk.get("type") if isinstance(chunk, dict) else None
        interrupts = _extract_interrupt_actions(chunk.get("data") if isinstance(chunk, dict) else chunk)
        if interrupts:
            response = ChatResponse(
                thread_id=context.thread_id or context.project_id,
                answer=(
                    "Evidence tool review is active. The Deep Agent paused before running evidence tools. "
                    "Approve the requested tool calls to continue, or reject them to continue without those tools."
                ),
                citations=[],
                interrupted=True,
                review_actions=interrupts,
            )
            yield {"type": "review", "message": "Deep Agent paused for evidence tool review.", "review_actions": interrupts}
            yield {"type": "final", "response": response.model_dump(mode="json")}
            yield {"type": "done"}
            return
        if chunk_type == "values":
            data = chunk.get("data")
            if isinstance(data, dict):
                last_values = data
            continue
        if chunk_type == "messages":
            token_event = _stream_token_event(chunk)
            if token_event:
                yield token_event
            continue
        yield _stream_event(chunk)

    interrupts = _extract_interrupt_actions(last_values)
    if interrupts:
        response = ChatResponse(
            thread_id=thread_id or project_id,
            answer=(
                "Evidence tool review is active. The Deep Agent paused before running evidence tools. "
                "Approve the requested tool calls to continue, or reject them to continue without those tools."
            ),
            citations=[],
            interrupted=True,
            review_actions=interrupts,
        )
        yield {"type": "review", "message": "Deep Agent paused for evidence tool review.", "review_actions": interrupts}
        yield {"type": "final", "response": response.model_dump(mode="json")}
        yield {"type": "done"}
        return

    structured = _extract_structured_answer(last_values)
    if structured:
        answer = _format_agent_answer(structured)
        citations = _citations_from_agent_answer(structured)
        if not citations:
            citations = [item.citation for item in search_corpus(context.project_id, question, limit=5, document_ids=context.document_ids)]
        if _is_incomplete_deliverable_answer(question, answer):
            evidence = search_corpus(context.project_id, question, limit=8, document_ids=context.document_ids)
            answer, retry_citations = _synthesize_final_answer(context, _force_deliverable_question(question), answer, evidence)
            citations = _dedupe_citations(retry_citations + citations)
        response = _persist_answer(project_id, question, answer, citations, thread_id, structured)
        yield {"type": "final", "response": response.model_dump(mode="json")}
        yield {"type": "done"}
        return

    message = (last_values.get("messages") or [None])[-1]
    content = getattr(message, "content", None) or str(message or "")
    evidence = search_corpus(context.project_id, question, limit=5, document_ids=context.document_ids)
    answer, citations = _synthesize_final_answer(context, question, str(content), evidence)
    response = _persist_answer(project_id, question, answer, citations, thread_id)
    yield {"type": "final", "response": response.model_dump(mode="json")}
    yield {"type": "done"}


def _extract_interrupt_actions(result: Any) -> list[dict[str, Any]]:
    interrupts = getattr(result, "interrupts", None)
    if interrupts:
        return _actions_from_interrupts(interrupts)
    if isinstance(result, dict):
        raw_interrupts = result.get("__interrupt__") or result.get("interrupts") or []
        return _actions_from_interrupts(raw_interrupts)
    return []


def _actions_from_interrupts(interrupts: Any) -> list[dict[str, Any]]:
    if not isinstance(interrupts, (list, tuple)):
        interrupts = [interrupts]
    actions: list[dict[str, Any]] = []
    for item in interrupts:
        value = getattr(item, "value", item)
        if not isinstance(value, dict):
            continue
        for action in value.get("action_requests") or []:
            if isinstance(action, dict):
                actions.append(action)
            else:
                action_name = getattr(action, "name", None)
                action_args = getattr(action, "args", None)
                actions.append({"name": action_name or "evidence tool", "args": action_args or {}})
    return actions


def _result_value(result: Any) -> dict[str, Any]:
    value = getattr(result, "value", None)
    if isinstance(value, dict):
        return value
    return result if isinstance(result, dict) else {}


def _stream_event(chunk: Any) -> dict[str, Any]:
    if not isinstance(chunk, dict):
        return {"type": "main", "message": _truncate(str(chunk), 240)}
    namespace = chunk.get("ns") or []
    data = chunk.get("data") or {}
    nodes = list(data.keys()) if isinstance(data, dict) else []
    is_subagent = bool(namespace)
    label = "Subagent" if is_subagent else "Main agent"
    if nodes:
        message = f"{label} step: {', '.join(str(node) for node in nodes)}"
    else:
        message = f"{label} update"
    return {"type": "subagent" if is_subagent else "main", "namespace": namespace, "nodes": nodes, "message": message}


def _stream_token_event(chunk: dict[str, Any]) -> dict[str, Any] | None:
    data = chunk.get("data")
    if not isinstance(data, (list, tuple)) or not data:
        return None
    token = data[0]
    content = getattr(token, "content", "")
    if isinstance(content, list):
        text = "".join(str(item.get("text", item)) if isinstance(item, dict) else str(item) for item in content)
    else:
        text = str(content or "")
    if not text:
        return None
    namespace = chunk.get("ns") or []
    return {
        "type": "token",
        "namespace": namespace,
        "source": "subagent" if namespace else "main",
        "message": text,
    }


@lru_cache(maxsize=2)
def get_financial_agent(human_review: bool = False) -> Any:
    from deepagents import GeneralPurposeSubagentProfile, HarnessProfile, create_deep_agent, register_harness_profile
    from langchain.agents.middleware import TodoListMiddleware

    excluded_tools = frozenset({"ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute"})
    profile = HarnessProfile(
        excluded_tools=excluded_tools,
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
    )
    register_harness_profile(f"nebius:{settings.reasoning_model}", profile)
    register_harness_profile(f"openai:{settings.reasoning_model}", profile)

    kwargs: dict[str, Any] = {}
    if human_review:
        kwargs["checkpointer"] = _human_review_checkpointer()
        kwargs["interrupt_on"] = {
            "agent_search_corpus": {"allowed_decisions": ["approve", "reject"]},
            "agent_get_page_context": {"allowed_decisions": ["approve", "reject"]},
            "agent_get_table": {"allowed_decisions": ["approve", "reject"]},
            "agent_get_visual": {"allowed_decisions": ["approve", "reject"]},
            "agent_compare_kpi": {"allowed_decisions": ["approve", "reject"]},
            "agent_verify_chart_against_table": {"allowed_decisions": ["approve", "reject"]},
            "agent_calculate_margin_bridge": {"allowed_decisions": ["approve", "reject"]},
            "agent_document_inventory": {"allowed_decisions": ["approve", "reject"]},
        }

    return create_deep_agent(
        model=_reasoning_model(),
        tools=FINANCIAL_AGENT_TOOLS,
        system_prompt=FINANCIAL_AGENT_SYSTEM_PROMPT,
        middleware=[TodoListMiddleware()],
        subagents=FINANCIAL_SUBAGENTS,
        context_schema=AgentContext,
        response_format=AgentAnswer,
        name="financial-report-analyst",
        **kwargs,
    )


@lru_cache(maxsize=1)
def _human_review_checkpointer() -> Any:
    from langgraph.checkpoint.sqlite import SqliteSaver

    settings.checkpoint_db_path.parent.mkdir(parents=True, exist_ok=True)
    context = SqliteSaver.from_conn_string(str(settings.checkpoint_db_path))
    saver = context.__enter__()
    saver.setup()
    _CHECKPOINTER_CONTEXTS.append(context)

    def close_context() -> None:
        if context in _CHECKPOINTER_CONTEXTS:
            _CHECKPOINTER_CONTEXTS.remove(context)
            context.__exit__(None, None, None)

    atexit.register(close_context)
    return saver


def _reasoning_model() -> Any:
    return reasoning_model()


def agent_search_corpus(query: str, limit: int = 8, runtime: ToolRuntime[AgentContext] | None = None) -> str:
    """Search uploaded reports and return compact page evidence with citations."""
    context = _runtime_context(runtime)
    evidence = search_corpus(context.project_id, query, min(limit, 12), context.document_ids)
    return _json([_evidence_to_compact(item).model_dump() for item in evidence])


def agent_get_page_context(document_id: str = "", page_number: int = 1, runtime: ToolRuntime[AgentContext] | None = None) -> str:
    """Fetch compact text, table, and visual context for one cited page."""
    context = _runtime_context(runtime)
    resolved_id = _resolve_document_id(context, document_id)
    if not resolved_id:
        return _json({"error": "document_id is required unless this workspace has exactly one matching document."})
    return _json(get_page_context(resolved_id, page_number))


def agent_get_table(document_id: str = "", page_number: int | None = None, table_id: str | None = None, runtime: ToolRuntime[AgentContext] | None = None) -> str:
    """Fetch compact table evidence by table ID or document/page."""
    context = _runtime_context(runtime)
    resolved_id = _resolve_document_id(context, document_id)
    if not resolved_id and not table_id:
        return _json({"error": "document_id or table_id is required. Use search_corpus or document_inventory first to choose evidence."})
    return _json(get_table(resolved_id, page_number, table_id))


def agent_get_visual(document_id: str = "", page_number: int | None = None, visual_id: str | None = None, runtime: ToolRuntime[AgentContext] | None = None) -> str:
    """Fetch compact Cosmos visual observations by visual ID or document/page."""
    context = _runtime_context(runtime)
    resolved_id = _resolve_document_id(context, document_id)
    if not resolved_id and not visual_id:
        return _json({"error": "document_id or visual_id is required. Use search_corpus or document_inventory first to choose visual evidence."})
    return _json(get_visual(resolved_id, page_number, visual_id))


def agent_compare_kpi(metric: str, period: str | None = None, runtime: ToolRuntime[AgentContext] | None = None) -> str:
    """Compare a normalized KPI across uploaded documents and optional period."""
    context = _runtime_context(runtime)
    return compare_kpi(context.project_id, metric, context.document_ids, period).model_dump_json()


def agent_verify_chart_against_table(query: str, runtime: ToolRuntime[AgentContext] | None = None) -> str:
    """Compare available chart observations against extracted table evidence."""
    context = _runtime_context(runtime)
    answer, citations = verify_chart_against_table(context.project_id, query, context.document_ids)
    return _json({"answer": answer, "citations": [citation.model_dump() for citation in citations]})


def agent_calculate_margin_bridge(metric: str = "operating margin", runtime: ToolRuntime[AgentContext] | None = None) -> str:
    """Calculate margin deltas and relative changes across comparable observations."""
    context = _runtime_context(runtime)
    answer, citations = calculate_margin_bridge(context.project_id, metric, context.document_ids)
    return _json({"answer": answer, "citations": [citation.model_dump() for citation in citations]})


def agent_document_inventory(include_evidence_counts: bool = True, runtime: ToolRuntime[AgentContext] | None = None) -> str:
    """List uploaded documents, covered periods, evidence counts, and first-page citations."""
    context = _runtime_context(runtime)
    return _json(document_inventory(context.project_id, context.document_ids, include_evidence_counts))


FINANCIAL_AGENT_TOOLS = (
    StructuredTool.from_function(agent_search_corpus, args_schema=SearchCorpusArgs),
    StructuredTool.from_function(agent_get_page_context, args_schema=PageContextArgs),
    StructuredTool.from_function(agent_get_table, args_schema=TableLookupArgs),
    StructuredTool.from_function(agent_get_visual, args_schema=VisualLookupArgs),
    StructuredTool.from_function(agent_compare_kpi, args_schema=CompareKPIArgs),
    StructuredTool.from_function(agent_verify_chart_against_table, args_schema=ChartTableVerifyArgs),
    StructuredTool.from_function(agent_calculate_margin_bridge, args_schema=MarginBridgeArgs),
    StructuredTool.from_function(agent_document_inventory, args_schema=DocumentInventoryArgs),
)

FINANCIAL_SUBAGENTS = (
    {
        "name": "kpi-analyst",
        "description": "Use for KPI comparisons, operating margin bridges, regional growth rankings, and arithmetic checks.",
        "system_prompt": KPI_SUBAGENT_PROMPT,
        "tools": [FINANCIAL_AGENT_TOOLS[0], FINANCIAL_AGENT_TOOLS[4], FINANCIAL_AGENT_TOOLS[6]],
        "response_format": AgentAnswer,
    },
    {
        "name": "visual-auditor",
        "description": "Use for chart-table agreement checks, visual observations, page screenshots, and infographic evidence.",
        "system_prompt": VISUAL_SUBAGENT_PROMPT,
        "tools": [FINANCIAL_AGENT_TOOLS[1], FINANCIAL_AGENT_TOOLS[2], FINANCIAL_AGENT_TOOLS[3], FINANCIAL_AGENT_TOOLS[5]],
        "response_format": AgentAnswer,
    },
    {
        "name": "filing-synthesizer",
        "description": "Use for document summaries, covered periods, management-stated causes, and cross-document filing narrative.",
        "system_prompt": FILING_SYNTHESIS_SUBAGENT_PROMPT,
        "tools": [FINANCIAL_AGENT_TOOLS[0], FINANCIAL_AGENT_TOOLS[1], FINANCIAL_AGENT_TOOLS[2], FINANCIAL_AGENT_TOOLS[3], FINANCIAL_AGENT_TOOLS[7]],
        "response_format": AgentAnswer,
    },
    {
        "name": "risk-strategy-analyst",
        "description": "Use for evidence-based investment frameworks, strategic risks, implications, and follow-up diligence questions.",
        "system_prompt": RISK_STRATEGY_SUBAGENT_PROMPT,
        "tools": [FINANCIAL_AGENT_TOOLS[0], FINANCIAL_AGENT_TOOLS[4], FINANCIAL_AGENT_TOOLS[6]],
        "response_format": AgentAnswer,
    },
)


def _runtime_context(runtime: ToolRuntime[AgentContext] | None) -> AgentContext:
    if runtime and isinstance(runtime.context, AgentContext):
        return runtime.context
    if runtime and isinstance(runtime.context, dict):
        return AgentContext(**runtime.context)
    return _get_active_context()


def _resolve_document_id(context: AgentContext, document_ref: str) -> str:
    normalized_ref = document_ref.strip()
    allowed_ids = set(context.document_ids or [])
    with Session(engine) as session:
        if normalized_ref:
            document = session.get(Document, normalized_ref)
            if document and (not allowed_ids or document.id in allowed_ids):
                return document.id
        candidates = session.exec(select(Document).where(Document.project_id == context.project_id)).all()
    if allowed_ids:
        candidates = [document for document in candidates if document.id in allowed_ids]
    if not normalized_ref:
        ready_candidates = [document for document in candidates if document.status == "ready"]
        if len(ready_candidates) == 1:
            return ready_candidates[0].id
        return ""
    ref_key = normalized_ref.casefold()
    ref_stem = re.sub(r"\.[a-z0-9]+$", "", ref_key)
    for document in candidates:
        filename_key = document.filename.casefold()
        filename_stem = re.sub(r"\.[a-z0-9]+$", "", filename_key)
        if ref_key == filename_key or ref_stem == filename_stem:
            return document.id
    for document in candidates:
        filename_key = document.filename.casefold()
        filename_stem = re.sub(r"\.[a-z0-9]+$", "", filename_key)
        if ref_key in filename_key or filename_stem in ref_key or ref_stem in filename_key:
            return document.id
    return document_ref


_ACTIVE_CONTEXT: ContextVar[AgentContext] = ContextVar("financial_agent_context", default=AgentContext(project_id=""))


def _set_active_context(context: AgentContext) -> None:
    _ACTIVE_CONTEXT.set(context)


def _get_active_context() -> AgentContext:
    return _ACTIVE_CONTEXT.get()


def _ready_document_count(project_id: str) -> int:
    with Session(engine) as session:
        return len(session.exec(select(Document).where(Document.project_id == project_id, Document.status == "ready")).all())


def _compact_page(session: Session, page: Page, max_chars: int = 2400) -> CompactEvidence:
    citation = _citation(session, page.document_id, page.page_number, "page", page.id, "text evidence")
    return CompactEvidence(
        evidence_id=page.id,
        document_id=page.document_id,
        document_name=citation.document_name,
        page_number=page.page_number,
        source_kind="page",
        source_id=page.id,
        label=citation.label,
        snippet=_truncate(page.text, max_chars),
        artifact_url=citation.artifact_url,
    )


def _compact_table(session: Session, table: TableBlock) -> CompactEvidence:
    citation = _citation(session, table.document_id, table.page_number, "table", table.id, "table evidence")
    return CompactEvidence(
        evidence_id=table.id,
        document_id=table.document_id,
        document_name=citation.document_name,
        page_number=table.page_number,
        source_kind="table",
        source_id=table.id,
        label=citation.label,
        table_markdown=_truncate(table.table_markdown, 1800),
        data={"rows": json_loads(table.rows_json, [])[:20] if isinstance(json_loads(table.rows_json, []), list) else json_loads(table.rows_json, [])},
        artifact_url=citation.artifact_url,
        bbox_json=table.bbox_json,
        confidence=table.confidence,
        extraction_method=table.extraction_method,
    )


def _compact_visual(session: Session, visual: VisualBlock) -> CompactEvidence:
    citation = _citation(session, visual.document_id, visual.page_number, "visual", visual.id, visual.title or "visual evidence")
    return CompactEvidence(
        evidence_id=visual.id,
        document_id=visual.document_id,
        document_name=citation.document_name,
        page_number=visual.page_number,
        source_kind="visual",
        source_id=visual.id,
        label=citation.label,
        visual_summary=_truncate(format_visual_observation(visual), 1600),
        data=json_loads(visual.data_json, {}),
        artifact_url=citation.artifact_url,
        bbox_json=visual.bbox_json,
        confidence=visual.confidence,
        extraction_method=visual.extraction_method,
    )


def _evidence_to_compact(evidence: Evidence) -> CompactEvidence:
    citation = evidence.citation
    return CompactEvidence(
        evidence_id=citation.source_id,
        document_id=citation.document_id,
        document_name=citation.document_name,
        page_number=citation.page_number,
        source_kind=citation.source_kind,
        source_id=citation.source_id,
        label=citation.label,
        snippet=evidence.text,
        artifact_url=citation.artifact_url,
        bbox_json=citation.bbox_json,
        confidence=citation.confidence,
        extraction_method="text",
    )


def _extract_structured_answer(result: dict[str, Any]) -> AgentAnswer | None:
    structured = result.get("structured_response")
    if isinstance(structured, AgentAnswer):
        return structured
    if structured:
        try:
            return AgentAnswer.model_validate(structured)
        except Exception:
            return None
    return None


def _format_agent_answer(answer: AgentAnswer) -> str:
    sections: list[str] = []
    if answer.summary:
        sections.append(answer.summary)
    if answer.management_stated_causes:
        sections.append("Management-stated causes:\n" + "\n".join(f"- {item}" for item in answer.management_stated_causes))
    if answer.arithmetic_facts:
        sections.append("Arithmetic facts:\n" + "\n".join(f"- {item}" for item in answer.arithmetic_facts))
    if answer.inference:
        sections.append("Inference:\n" + "\n".join(f"- {item}" for item in answer.inference))
    if answer.needs_more_evidence:
        sections.append("Needs more evidence:\n" + "\n".join(f"- {item}" for item in answer.needs_more_evidence))
    if answer.citations:
        refs = [f"{citation.document_name} p.{citation.page_number} ({citation.source_kind})" for citation in answer.citations]
        sections.append("References: " + "; ".join(refs))
    return "\n\n".join(sections).strip() or "The agent completed analysis but did not return a textual answer."


def _citations_from_agent_answer(answer: AgentAnswer) -> list[CitationRead]:
    return [
        CitationRead(
            document_id=citation.document_id,
            document_name=citation.document_name,
            page_number=citation.page_number,
            source_kind=citation.source_kind,
            source_id=citation.source_id,
            label=citation.label,
            artifact_url=citation.artifact_url,
            bbox_json=citation.bbox_json,
            confidence=citation.confidence,
        )
        for citation in answer.citations
    ]


def _persist_answer(
    project_id: str,
    question: str,
    answer: str,
    citations: list[CitationRead],
    thread_id: str | None,
    structured_answer: AgentAnswer | None = None,
) -> ChatResponse:
    with Session(engine) as session:
        thread = session.get(ChatThread, thread_id) if thread_id else None
        if thread is None:
            thread = ChatThread(project_id=project_id, title=question[:80] or "Analysis")
            session.add(thread)
            session.commit()
            session.refresh(thread)
        saved = Answer(
            thread_id=thread.id,
            project_id=project_id,
            question=question,
            answer=answer,
            citations_json="[" + ",".join(citation.model_dump_json() for citation in citations) + "]",
        )
        session.add(saved)
        session.commit()
        return ChatResponse(thread_id=thread.id, answer=answer, citations=citations, structured_answer=structured_answer)


def _snippet(text: str, terms: list[str]) -> str:
    compact = " ".join(text.split())
    lowered = compact.lower()
    positions = [lowered.find(term) for term in terms if lowered.find(term) >= 0]
    start = max(min(positions) - 220, 0) if positions else 0
    return compact[start : start + 700]


def _strongest_region(project_id: str) -> tuple[str, list[CitationRead]]:
    comparison = compare_kpi(project_id, "regional revenue")
    if not comparison.points:
        evidence = search_corpus(project_id, "region revenue growth strongest")
        return (
            "I did not find normalized regional revenue KPI rows yet. Relevant regional evidence:\n\n"
            + "\n\n".join(f"- {item.text}" for item in evidence),
            [item.citation for item in evidence],
        )
    by_segment: dict[str, list[ComparePoint]] = {}
    for point in comparison.points:
        if point.segment:
            by_segment.setdefault(point.segment, []).append(point)
    ranked: list[tuple[float, str, ComparePoint, ComparePoint]] = []
    for segment, points in by_segment.items():
        by_scope: dict[tuple[str, str], list[ComparePoint]] = {}
        for point in points:
            by_scope.setdefault((_period_duration(point.period), point.document_id), []).append(point)
        for scoped_points in by_scope.values():
            if len(scoped_points) < 2:
                continue
            scoped_points.sort(key=lambda item: _period_date(item.period) or datetime.min)
            first = scoped_points[0]
            last = scoped_points[-1]
            change = growth_rate(last.value, first.value)
            if change is not None:
                ranked.append((change, segment, first, last))
    if not ranked:
        return "I found regional revenue values, but not enough comparable periods to rank growth.", []
    ranked.sort(reverse=True, key=lambda item: item[0])
    change, segment, first, last = ranked[0]
    ranked_lines = [
        (
            f"- {ranked_segment}: {ranked_first.value:g}{ranked_first.unit} in {ranked_first.period} "
            f"to {ranked_last.value:g}{ranked_last.unit} in {ranked_last.period} = {ranked_change:.1f}%"
        )
        for ranked_change, ranked_segment, ranked_first, ranked_last in ranked[:12]
    ]
    with Session(engine) as session:
        citations = [
            _citation(session, first.document_id, first.page_number, "kpi", "", first.metric),
            _citation(session, last.document_id, last.page_number, "kpi", "", last.metric),
        ]
    detail = (
        f"{segment} had the strongest observed comparable-period growth at {change:.1f}%, "
        f"moving from {first.value:g}{first.unit} in {first.period} to {last.value:g}{last.unit} in {last.period}."
    )
    return detail + "\n\nComparable regional growth calculations:\n" + "\n".join(ranked_lines), citations


def _period_duration(period: str) -> str:
    match = re.match(r"((?:Three|Six|Nine|Twelve) Months Ended)", period, flags=re.I)
    return match.group(1).lower() if match else period.lower()


def _period_date(period: str) -> datetime | None:
    match = re.search(r"([A-Z][a-z]+ \d{1,2}, \d{4})", period)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%B %d, %Y")
    except ValueError:
        return None


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), default=_json_default)


def _json_default(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _synthesize_visual_answer(project_id: str, question: str, evidence: list[Evidence]) -> tuple[str, list[CitationRead]]:
    citations = [item.citation for item in evidence]
    if not evidence:
        return (
            "I do not have a Cosmos visual observation that matches this image or chart yet. "
            "Upload the image again, wait for the document row to show a Cosmos badge, then ask me to read it.",
            [],
        )
    evidence_text = "\n\n".join(
        f"- {item.citation.document_name} p.{item.citation.page_number} ({item.citation.source_kind}): {item.text}"
        for item in evidence[:6]
    )
    prompt = (
        "Question:\n"
        f"{question}\n\n"
        "Cosmos visual observations and matching artifacts:\n"
        f"{evidence_text}"
    )
    system_prompt = (
        "You are the visual-answer writer for a multimodal financial report analyst. "
        "Answer directly from the supplied Cosmos visual observations and rendered artifacts. "
        "If the visual is not financial, identify what it shows and say it is not financial evidence. "
        "For financial visuals, extract visible companies, metrics, periods, segments, values, labels, and uncertainty. "
        "Do not invent values that are not visible in the provided observations. Cite each visual as `Document name p.N`."
    )
    model = _reasoning_model()
    response = model.invoke(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
    )
    content = str(getattr(response, "content", None) or response).strip()
    content = _normalize_generic_citation_text(content, citations)
    return content, _prioritize_answer_citations(content, _dedupe_citations(citations))


def _normalize_generic_citation_text(content: str, citations: list[CitationRead]) -> str:
    if not citations:
        return content
    by_page = {citation.page_number: citation for citation in citations}

    def replace_page(match: re.Match[str]) -> str:
        page_number = int(match.group(1))
        citation = by_page.get(page_number) or citations[0]
        return f"{citation.document_name} p.{page_number}"

    content = re.sub(r"\bDocument name p\.(\d+)\b", replace_page, content)
    content = re.sub(r"\bdocument name p\.(\d+)\b", replace_page, content, flags=re.I)
    if not any(citation.document_name in content and f"p.{citation.page_number}" in content for citation in citations):
        citation = citations[0]
        content = f"{content.rstrip()} [{citation.document_name} p.{citation.page_number}]"
    return content


def _prioritize_answer_citations(content: str, citations: list[CitationRead]) -> list[CitationRead]:
    mentioned_pages = [int(match) for match in re.findall(r"\bp\.(\d+)\b", content, flags=re.I)]
    if not mentioned_pages:
        return citations
    order = {page: index for index, page in enumerate(mentioned_pages)}
    return sorted(citations, key=lambda citation: (order.get(citation.page_number, 10_000), citations.index(citation)))


def _focused_direct_visual_evidence(question: str, evidence: list[Evidence]) -> list[Evidence]:
    if len(evidence) <= 1:
        return evidence
    target_terms = _target_terms(question)
    if target_terms:
        targeted = [
            item
            for item in evidence
            if any(term in f"{item.citation.document_name} {item.text}".lower() for term in target_terms)
        ]
        if targeted:
            return targeted[:4]
    top = max(evidence, key=lambda item: item.score)
    if top.score >= 20:
        same_document = [item for item in evidence if item.citation.document_id == top.citation.document_id]
        if same_document:
            return same_document[:4]
    return evidence[:4]


def _synthesize_final_answer(context: AgentContext, question: str, agent_trace: str, evidence: list[Evidence]) -> tuple[str, list[CitationRead]]:
    citations = [item.citation for item in evidence]
    supplemental_sections: list[str] = [_project_brief(context.project_id, context.document_ids)]
    if "chart" in question.lower() and "table" in question.lower():
        check, check_citations = verify_chart_against_table(context.project_id, question, context.document_ids)
        supplemental_sections.append("Chart/table evidence:\n" + check)
        citations.extend(check_citations)
    if "margin" in question.lower():
        bridge, bridge_citations = calculate_margin_bridge(context.project_id, "operating margin", context.document_ids)
        supplemental_sections.append("Margin bridge evidence:\n" + bridge)
        citations.extend(bridge_citations)
    if "compare" in question.lower() or "revenue" in question.lower() or "sales" in question.lower():
        comparison = compare_kpi(context.project_id, "revenue", context.document_ids)
        supplemental_sections.append("Revenue comparison records:\n" + comparison.model_dump_json())
    if any(term in question.lower() for term in ("region", "regional", "geographic", "segment")):
        regional, regional_citations = _strongest_region(context.project_id)
        supplemental_sections.append("Regional growth evidence:\n" + regional)
        citations.extend(regional_citations)
    evidence_text = "\n\n".join(
        f"- {item.citation.document_name} p.{item.citation.page_number} ({item.citation.source_kind}): {item.text}"
        for item in evidence[:8]
    )
    prompt = (
        "Question:\n"
        f"{question}\n\n"
        "Uploaded-document context:\n"
        + "\n\n".join(section for section in supplemental_sections if section.strip())
        + "\n\nRetrieved evidence:\n"
        + (evidence_text or "No matching snippets were retrieved.")
    )
    synthesis_system = (
        "You are the final-answer writer for a financial report Deep Agent. Produce a concise analyst answer. "
        "Ground company-specific facts in the uploaded-document evidence provided. You may add general finance knowledge, decision framing, "
        "risk analysis, and analyst inference when clearly labeled. Do not use live web data, live prices, or personalized financial advice. "
        "Do not expose tool names, raw JSON, internal IDs, XML-like tags, or stack traces. "
        "Cite documents as `Document name p.N`. Separate management-stated causes, arithmetic facts, and inference when relevant. "
        "If evidence is missing, say exactly what is missing."
    )
    if _is_direct_deliverable_request(question):
        synthesis_system += (
            " The user requested a deliverable. Return the finished deliverable now with clear sections. "
            "Do not say you are building, preparing, or ready to build it, and do not ask for confirmation."
        )
    model = _reasoning_model()
    response = model.invoke(
        [
            {"role": "system", "content": synthesis_system},
            {"role": "user", "content": prompt},
        ]
    )
    content = getattr(response, "content", None) or str(response)
    if _looks_like_tool_markup(str(content)):
        content = _strict_synthesis_retry(synthesis_system, prompt)
    return str(content).strip(), _dedupe_citations(citations)


def _looks_like_tool_markup(content: str) -> bool:
    lowered = content.lower()
    return "<tool_call" in lowered or "</tool_call" in lowered or "agent_get_" in lowered or "agent_search_" in lowered


def _strict_synthesis_retry(system_prompt: str, prompt: str) -> str:
    model = _reasoning_model()
    response = model.invoke(
        [
            {
                "role": "system",
                "content": system_prompt
                + " You must answer in natural language only. You do not have tools in this step. Never output tool-call markup.",
            },
            {"role": "user", "content": prompt},
        ]
    )
    return str(getattr(response, "content", None) or response)


def _project_brief(project_id: str, document_ids: list[str] | None = None) -> str:
    with Session(engine) as session:
        allowed = _allowed_document_ids(session, project_id, document_ids)
        documents = session.exec(select(Document).where(col(Document.id).in_(allowed))).all() if allowed else []
        lines = []
        stored_brief = get_workspace_brief(project_id)
        if stored_brief and not document_ids:
            lines.append(
                "Stored Nemotron workspace brief:\n"
                f"Summary: {stored_brief.summary}\n"
                f"Companies: {', '.join(stored_brief.companies) or 'n/a'}\n"
                f"Periods: {', '.join(stored_brief.periods) or 'n/a'}\n"
                f"Key KPIs: {'; '.join(stored_brief.key_kpis) or 'n/a'}\n"
                f"Visual findings: {'; '.join(stored_brief.visual_findings) or 'n/a'}\n"
                f"Suggested investigations: {'; '.join(stored_brief.suggested_questions) or 'n/a'}"
            )
        for document in documents:
            text_count = len(session.exec(select(TextBlock).where(TextBlock.document_id == document.id)).all())
            table_count = len(session.exec(select(TableBlock).where(TableBlock.document_id == document.id)).all())
            visual_count = len(session.exec(select(VisualBlock).where(VisualBlock.document_id == document.id)).all())
            kpi_count = len(session.exec(select(KPIRecord).where(KPIRecord.document_id == document.id)).all())
            lines.append(
                f"- {document.filename}: status={document.status}, pages={document.page_count}, "
                f"text={text_count}, tables={table_count}, cosmos_visuals={visual_count}, "
                f"vision_coverage={document.vision_coverage} {document.vision_pages_analyzed}/{document.vision_pages_possible}, "
                f"kpis={kpi_count}, "
                f"summary={_truncate(document.summary, 900)}"
            )
        return "\n".join(lines)


def _dedupe_citations(citations: list[CitationRead]) -> list[CitationRead]:
    seen: set[tuple[str, int, str, str]] = set()
    deduped: list[CitationRead] = []
    for citation in citations:
        key = (citation.document_id, citation.page_number, citation.source_kind, citation.source_id)
        if key not in seen:
            deduped.append(citation)
            seen.add(key)
    return deduped[:12]


def _truncate(value: str, limit: int) -> str:
    compact = " ".join((value or "").split())
    return compact[:limit] + ("..." if len(compact) > limit else "")


def _table_preview(table_markdown: str) -> str:
    lines = [line for line in table_markdown.splitlines() if line.strip()]
    useful = [line for line in lines if not set(line.replace("|", "").strip()) <= {"-"}]
    return "\n".join(useful[:6])[:900]


def _helpful_no_evidence_answer(question: str, project_id: str) -> str:
    with Session(engine) as session:
        doc_count = len(_allowed_document_ids(session, project_id))
    if doc_count == 0:
        return "I do not have uploaded document evidence in this workspace yet. Upload a report or presentation, wait until ingestion is ready, then ask again."
    return (
        "I do not see direct document evidence for that exact question yet.\n\n"
        "What I can do next: ask me to inspect a specific page, compare a named KPI, summarize a report section, "
        "rank regions or segments, or generate follow-up diligence questions from the available filings.\n\n"
        "Analyst inference: for questions that are strategic or forward-looking, I can provide a clearly labeled reasoning framework, "
        "but I will keep company-specific claims tied to uploaded pages and tables."
    )
