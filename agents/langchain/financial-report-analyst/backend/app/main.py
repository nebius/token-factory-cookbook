from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import Session, col, delete, select

from app.agent import ModelUnavailableError, answer_question, compare_kpi, generate_research_plan, resume_human_review, stream_chat_response
from app.briefing import clear_workspace_brief, get_workspace_brief, refresh_workspace_brief
from app.config import load_dotenv_if_present, settings
from app.database import get_session, init_db
from app.ingestion import process_document
from app.models import (
    ChatRequest,
    ChatResponse,
    ChatHistoryItem,
    ChatThread,
    CompareRequest,
    CompareResponse,
    Answer,
    Citation,
    Document,
    DocumentRead,
    Job,
    JobRead,
    HumanReviewRequest,
    KPIRecord,
    Page,
    PageRead,
    Project,
    ProjectCreate,
    ProjectRead,
    ResearchPlanRequest,
    ResearchPlanResponse,
    TableBlock,
    TextBlock,
    VisualBlock,
    WorkspaceBrief,
    WorkspaceBriefRead,
    json_loads,
    CitationRead,
)
from app.storage import artifact_url, resolve_artifact, save_upload
from app.visual_format import format_visual_summary

load_dotenv_if_present()

app = FastAPI(title="Multimodal Financial Report Analyst", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/runtime")
def runtime_status() -> dict[str, object]:
    return {
        "model_calls_enabled": settings.enable_model_calls,
        "nebius_configured": bool(settings.nebius_api_key),
        "reasoning_model": settings.reasoning_model,
        "vision_model": settings.vision_model,
        "max_vision_pages": settings.max_vision_pages,
    }


@app.post("/projects", response_model=ProjectRead)
def create_project(payload: ProjectCreate, session: Session = Depends(get_session)) -> Project:
    project = Project(name=payload.name)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@app.get("/projects", response_model=list[ProjectRead])
def list_projects(session: Session = Depends(get_session)) -> list[Project]:
    return session.exec(select(Project).order_by(Project.created_at.desc())).all()


@app.delete("/projects/{project_id}")
def delete_project(project_id: str, session: Session = Depends(get_session)) -> dict[str, str]:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    documents = session.exec(select(Document).where(Document.project_id == project_id)).all()
    doc_ids = [document.id for document in documents]
    threads = session.exec(select(ChatThread).where(ChatThread.project_id == project_id)).all()
    thread_ids = [thread.id for thread in threads]
    if doc_ids:
        for model in (Page, TextBlock, TableBlock, VisualBlock, KPIRecord, Citation):
            session.exec(delete(model).where(col(model.document_id).in_(doc_ids)))
        session.exec(delete(Job).where(col(Job.document_id).in_(doc_ids)))
        session.exec(delete(Document).where(col(Document.id).in_(doc_ids)))
    session.exec(delete(WorkspaceBrief).where(WorkspaceBrief.project_id == project_id))
    if thread_ids:
        session.exec(delete(Answer).where(col(Answer.thread_id).in_(thread_ids)))
        session.exec(delete(ChatThread).where(col(ChatThread.id).in_(thread_ids)))
    session.delete(project)
    session.commit()
    project_path = settings.storage_root / "projects" / project_id
    shutil.rmtree(project_path, ignore_errors=True)
    return {"status": "deleted"}


@app.get("/briefs", response_model=WorkspaceBriefRead | None)
def get_brief(project_id: str) -> WorkspaceBriefRead | None:
    return get_workspace_brief(project_id)


@app.post("/briefs/refresh", response_model=WorkspaceBriefRead | None)
def refresh_brief(project_id: str) -> WorkspaceBriefRead | None:
    try:
        return refresh_workspace_brief(project_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/documents", response_model=JobRead)
async def upload_document(
    background_tasks: BackgroundTasks,
    project_id: str = Query(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> Job:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    document = Document(project_id=project_id, filename=file.filename or "upload", content_type=file.content_type or "", storage_path="")
    session.add(document)
    session.commit()
    session.refresh(document)
    saved_path = await save_upload(project_id, document.id, file)
    document.storage_path = str(saved_path)
    document.status = "queued"
    job = Job(project_id=project_id, document_id=document.id, status="queued", message="Upload saved. Waiting for ingestion.")
    session.add(document)
    session.add(job)
    session.commit()
    session.refresh(job)
    background_tasks.add_task(process_document, document.id, job.id)
    return job


@app.get("/documents", response_model=list[DocumentRead])
def list_documents(project_id: str, session: Session = Depends(get_session)) -> list[DocumentRead]:
    documents = session.exec(select(Document).where(Document.project_id == project_id).order_by(Document.created_at.desc())).all()
    reads: list[DocumentRead] = []
    for document in documents:
        text_count = len(session.exec(select(TextBlock).where(TextBlock.document_id == document.id)).all())
        table_count = len(session.exec(select(TableBlock).where(TableBlock.document_id == document.id)).all())
        visual_count = len(session.exec(select(VisualBlock).where(VisualBlock.document_id == document.id)).all())
        kpi_count = len(session.exec(select(KPIRecord).where(KPIRecord.document_id == document.id)).all())
        if _is_brief_only_error(document) and (document.page_count > 0 or text_count or table_count or visual_count or kpi_count):
            document.status = "ready"
            document.error = ""
            session.add(document)
            session.commit()
            session.refresh(document)
        reads.append(
            DocumentRead(
                **document.model_dump(),
                text_count=text_count,
                table_count=table_count,
                visual_count=visual_count,
                kpi_count=kpi_count,
            )
        )
    return reads


def _is_brief_only_error(document: Document) -> bool:
    if document.status != "error":
        return False
    error = document.error or ""
    return any(term in error for term in ("BriefPayload", "Expecting value", "workspace briefing"))


@app.delete("/documents/{document_id}")
def delete_document(document_id: str, session: Session = Depends(get_session)) -> dict[str, str]:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    project_id = document.project_id
    storage_path = document.storage_path
    for model in (Page, TextBlock, TableBlock, VisualBlock, KPIRecord, Citation):
        session.exec(delete(model).where(model.document_id == document_id))
    session.exec(delete(Job).where(Job.document_id == document_id))
    session.delete(document)
    session.commit()
    if storage_path:
        try:
            document_path = Path(storage_path).resolve().parents[1]
            shutil.rmtree(document_path, ignore_errors=True)
        except IndexError:
            pass
    if session.exec(select(Document).where(Document.project_id == project_id, Document.status == "ready")).first():
        try:
            refresh_workspace_brief(project_id)
        except RuntimeError:
            pass
    else:
        clear_workspace_brief(project_id)
    return {"status": "deleted"}


@app.get("/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: str, session: Session = Depends(get_session)) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/jobs", response_model=list[JobRead])
def list_jobs(project_id: str, session: Session = Depends(get_session)) -> list[Job]:
    return session.exec(select(Job).where(Job.project_id == project_id).order_by(Job.updated_at.desc())).all()


@app.get("/pages", response_model=list[PageRead])
def list_pages(document_id: str, session: Session = Depends(get_session)) -> list[PageRead]:
    pages = session.exec(select(Page).where(Page.document_id == document_id).order_by(Page.page_number)).all()
    reads: list[PageRead] = []
    for page in pages:
        visuals = session.exec(select(VisualBlock).where(VisualBlock.document_id == page.document_id, VisualBlock.page_number == page.page_number)).all()
        reads.append(
            PageRead(
                id=page.id,
                document_id=page.document_id,
                page_number=page.page_number,
                text=page.text,
                image_url=artifact_url(page.image_path),
                visual_summary=format_visual_summary(visuals),
                visual_count=len(visuals),
            )
        )
    return reads


@app.get("/documents/{document_id}/pages/{page_number}", response_model=PageRead)
def get_page(document_id: str, page_number: int, session: Session = Depends(get_session)) -> PageRead:
    page = session.exec(select(Page).where(Page.document_id == document_id, Page.page_number == page_number)).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    visuals = session.exec(select(VisualBlock).where(VisualBlock.document_id == page.document_id, VisualBlock.page_number == page.page_number)).all()
    return PageRead(
        id=page.id,
        document_id=page.document_id,
        page_number=page.page_number,
        text=page.text,
        image_url=artifact_url(page.image_path),
        visual_summary=format_visual_summary(visuals),
        visual_count=len(visuals),
    )


@app.get("/kpis")
def list_kpis(project_id: str, session: Session = Depends(get_session)) -> list[dict]:
    documents = session.exec(select(Document).where(Document.project_id == project_id)).all()
    doc_ids = {document.id for document in documents}
    if not doc_ids:
        return []
    records = session.exec(select(KPIRecord).where(col(KPIRecord.document_id).in_(doc_ids))).all()
    names = {document.id: document.filename for document in documents}
    return [{**record.model_dump(), "document_name": names.get(record.document_id, "")} for record in records]


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    try:
        return answer_question(payload.project_id, payload.question, payload.thread_id, payload.human_review)
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/chat/plan", response_model=ResearchPlanResponse)
def chat_plan(payload: ResearchPlanRequest) -> ResearchPlanResponse:
    try:
        return generate_research_plan(payload.project_id, payload.question, payload.attachments)
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/chat/history", response_model=list[ChatHistoryItem])
def chat_history(project_id: str, session: Session = Depends(get_session)) -> list[ChatHistoryItem]:
    answers = session.exec(select(Answer).where(Answer.project_id == project_id).order_by(Answer.created_at)).all()
    history: list[ChatHistoryItem] = []
    for answer in answers:
        citations = []
        for citation in json_loads(answer.citations_json, []):
            try:
                citations.append(CitationRead.model_validate(citation))
            except Exception:
                continue
        history.append(
            ChatHistoryItem(
                id=answer.id,
                thread_id=answer.thread_id,
                question=answer.question,
                answer=answer.answer,
                citations=citations,
                created_at=answer.created_at,
            )
        )
    return history


@app.post("/chat/resume", response_model=ChatResponse)
def resume_chat(payload: HumanReviewRequest) -> ChatResponse:
    try:
        return resume_human_review(payload.project_id, payload.thread_id, payload.decisions)
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/chat/stream")
def stream_chat(payload: ChatRequest) -> StreamingResponse:
    def events():
        import json

        try:
            for event in stream_chat_response(payload.project_id, payload.question, payload.thread_id, payload.human_review):
                yield f"data: {json.dumps(event, ensure_ascii=True)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=True)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/compare", response_model=CompareResponse)
def compare(payload: CompareRequest) -> CompareResponse:
    return compare_kpi(payload.project_id, payload.metric, payload.document_ids, payload.period)


@app.get("/artifacts/{relative_path:path}")
def get_artifact(relative_path: str) -> FileResponse:
    path = resolve_artifact(relative_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")
    return FileResponse(Path(path))
