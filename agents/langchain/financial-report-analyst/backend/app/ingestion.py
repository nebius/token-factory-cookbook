from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, col, select

from app.database import engine
from app.briefing import refresh_workspace_brief
from app.extraction import extract_document
from app.kpi import extract_kpis_from_table, extract_kpis_from_text
from app.config import settings
from app.models import Document, Job, KPIRecord, Page, TableBlock, TextBlock, VisualBlock, now_utc
from app.nebius import analyze_visual_observation


def update_job(session: Session, job: Job, status: str, message: str) -> None:
    job.status = status
    job.message = message
    job.updated_at = now_utc()
    session.add(job)
    session.commit()


def process_document(document_id: str, job_id: str) -> None:
    with Session(engine) as session:
        document = session.get(Document, document_id)
        job = session.get(Job, job_id)
        if not document or not job:
            return
        project_id = document.project_id
        if job.document_id != document.id or job.project_id != project_id:
            return
        try:
            if settings.enable_model_calls and not settings.nebius_api_key:
                raise RuntimeError("Nebius API key is required for AI document ingestion. Set NEBIUS_API_KEY and restart the backend.")
            document.status = "processing"
            session.add(document)
            update_job(session, job, "processing", _ingestion_message())
            artifact_dir = Path(document.storage_path).resolve().parents[1]
            extracted_pages = extract_document(Path(document.storage_path), artifact_dir)
            if not _document_job_exists(document_id, job_id, project_id):
                session.rollback()
                return
            visual_summaries: list[str] = []
            vision_coverage = determine_vision_coverage(document, extracted_pages)
            visual_possible = len([page for page in extracted_pages if page.get("image_path")])
            visual_analyzed = 0

            session.exec(select(Page).where(Page.document_id == document.id)).all()
            for page_info in extracted_pages:
                if not _document_job_exists(document_id, job_id, project_id):
                    session.rollback()
                    return
                page_number = int(page_info["page_number"])
                page = Page(
                    document_id=document.id,
                    page_number=page_number,
                    text=page_info.get("text", ""),
                    image_path=page_info.get("image_path", ""),
                )
                session.add(page)
                text = page.text.strip()
                if text:
                    session.add(TextBlock(document_id=document.id, page_number=page_number, text=text[:25000]))
                for table_info in page_info.get("tables", []):
                    session.add(
                        TableBlock(
                            document_id=document.id,
                            page_number=page_number,
                            table_markdown=table_info["table_markdown"],
                            rows_json=table_info["rows_json"],
                        )
                    )
                    for kpi in extract_kpis_from_table(table_info.get("rows", []), page_number, text):
                        session.add(
                            KPIRecord(
                                document_id=document.id,
                                metric=kpi.metric,
                                period=kpi.period,
                                value=kpi.value,
                                unit=kpi.unit,
                                segment=kpi.segment,
                                page_number=kpi.page_number,
                                source_text=kpi.source_text,
                                confidence=kpi.confidence,
                                extraction_method="table",
                            )
                        )
                for kpi in extract_kpis_from_text(text, page_number):
                    session.add(
                        KPIRecord(
                            document_id=document.id,
                            metric=kpi.metric,
                            period=kpi.period,
                            value=kpi.value,
                            unit=kpi.unit,
                            segment=kpi.segment,
                            page_number=kpi.page_number,
                            source_text=kpi.source_text,
                            confidence=kpi.confidence,
                        )
                    )
                if (
                    page.image_path
                    and settings.enable_model_calls
                    and settings.nebius_api_key
                    and should_analyze_visual_page(page_number, text, page_info.get("tables", []), vision_coverage)
                ):
                    visual = create_visual_observation(session, document.id, page_number, page.image_path)
                    if not _document_job_exists(document_id, job_id, project_id):
                        session.rollback()
                        return
                    visual_analyzed += 1
                    if visual.summary:
                        visual_summaries.append(visual.summary)

            if not _document_job_exists(document_id, job_id, project_id):
                session.rollback()
                return
            document.page_count = len(extracted_pages)
            document.vision_coverage = vision_coverage
            document.vision_pages_analyzed = visual_analyzed
            document.vision_pages_possible = visual_possible
            document.status = "ready"
            document.error = ""
            document.summary = build_document_summary(document.filename, extracted_pages, visual_summaries)
            session.add(document)
            session.commit()
            brief_warning = ""
            try:
                refresh_workspace_brief(project_id)
            except Exception as exc:
                brief_warning = f" Workspace brief will refresh on the next upload or question: {str(exc)[:180]}"
            update_job(session, job, "complete", f"Ready: extracted {document.page_count} pages.{brief_warning}")
        except Exception as exc:
            if not _document_job_exists(document_id, job_id, project_id):
                session.rollback()
                return
            document.status = "error"
            document.error = str(exc)[:1000]
            session.add(document)
            session.commit()
            update_job(session, job, "error", document.error)


def create_visual_observation(session: Session, document_id: str, page_number: int, image_path: str) -> VisualBlock:
    observation = analyze_visual_observation(Path(image_path))
    summary = observation.summary or "Visual page observation is available."
    visual = VisualBlock(
        document_id=document_id,
        page_number=page_number,
        title=observation.title or f"Page {page_number}",
        kind=observation.visual_type or "page",
        summary=summary[:5000],
        image_path=image_path,
        data_json=observation.model_dump_json(),
        confidence=_visual_confidence(observation.uncertainty),
        extraction_method="cosmos" if observation.uncertainty != "model disabled" else "render",
    )
    session.add(visual)
    return visual


def _document_job_exists(document_id: str, job_id: str, project_id: str) -> bool:
    with Session(engine) as session:
        document = session.get(Document, document_id)
        job = session.get(Job, job_id)
        return bool(
            document
            and job
            and document.project_id == project_id
            and job.project_id == project_id
            and job.document_id == document_id
        )


def ensure_missing_visual_observations(project_id: str) -> int:
    if not settings.enable_model_calls or not settings.nebius_api_key:
        return 0
    created = 0
    with Session(engine) as session:
        documents = session.exec(select(Document).where(Document.project_id == project_id, Document.status == "ready")).all()
        doc_ids = {document.id for document in documents}
        if not doc_ids:
            return 0
        pages = session.exec(select(Page).where(col(Page.document_id).in_(doc_ids))).all()
        for page in pages:
            if not page.image_path:
                continue
            existing = session.exec(
                select(VisualBlock).where(VisualBlock.document_id == page.document_id, VisualBlock.page_number == page.page_number)
            ).first()
            if existing:
                continue
            tables = session.exec(select(TableBlock).where(TableBlock.document_id == page.document_id, TableBlock.page_number == page.page_number)).all()
            if not should_analyze_visual_page(page.page_number, page.text, [table.model_dump() for table in tables]):
                continue
            create_visual_observation(session, page.document_id, page.page_number, page.image_path)
            created += 1
            document = session.get(Document, page.document_id)
            if document:
                document.vision_pages_analyzed += 1
                session.add(document)
        session.commit()
    return created


def build_document_summary(filename: str, pages: list[dict], visual_summaries: list[str] | None = None) -> str:
    text = "\n".join(page.get("text", "") for page in pages)[:1200]
    if not text.strip():
        if visual_summaries:
            return f"{filename}: Cosmos visual summary: {visual_summaries[0][:900]}"
        return f"{filename}: visual document with rendered page artifacts."
    return f"{filename}: {text.strip()[:900]}"


def _ingestion_message() -> str:
    if not settings.enable_model_calls or not settings.nebius_api_key:
        return "Waiting for Nebius model configuration."
    return "Extracting pages, tables, KPIs, and visual evidence."


def determine_vision_coverage(document: Document, pages: list[dict]) -> str:
    possible = len([page for page in pages if page.get("image_path")])
    if possible == 0:
        return "none"
    return "full" if possible <= settings.max_vision_pages else "capped"


def should_analyze_visual_page(page_number: int, text: str, tables: list[dict], coverage: str | None = None) -> bool:
    return page_number <= settings.max_vision_pages


def _visual_confidence(uncertainty: str) -> float:
    lowered = uncertainty.lower()
    if "disabled" in lowered:
        return 0.2
    if "low" in lowered or "approx" in lowered or "uncertain" in lowered:
        return 0.55
    return 0.75
