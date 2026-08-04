from fastapi.testclient import TestClient

from app import agent as agent_module
from app.database import engine, init_db
from app.main import app
from app.models import Document
from sqlmodel import Session


def test_create_project() -> None:
    init_db()
    client = TestClient(app)
    response = client.post("/projects", json={"name": "Demo company"})
    assert response.status_code == 200
    assert response.json()["name"] == "Demo company"


def test_non_finance_prompt_refuses_even_with_documents(monkeypatch) -> None:
    init_db()
    client = TestClient(app)
    project = client.post("/projects", json={"name": "Guardrail"}).json()
    with Session(engine) as session:
        session.add(
            Document(
                project_id=project["id"],
                filename="report.pdf",
                storage_path="/tmp/report.pdf",
                status="ready",
                page_count=1,
            )
        )
        session.commit()
    monkeypatch.setattr(
        agent_module,
        "_try_deep_agent",
        lambda context, question, human_review=False: (
            "I can only help with financial analysis in this workspace.",
            [],
            None,
            False,
            [],
        ),
    )

    response = client.post("/chat", json={"project_id": project["id"], "question": "Write a haiku about mountain sunsets."})

    assert response.status_code == 200
    body = response.json()
    assert "I can only help with financial analysis" in body["answer"]
    assert body["citations"] == []


def test_chat_history_returns_persisted_workspace_messages() -> None:
    init_db()
    client = TestClient(app)
    project = client.post("/projects", json={"name": "Chat history"}).json()

    chat_response = client.post("/chat", json={"project_id": project["id"], "question": "Hi"})
    assert chat_response.status_code == 200

    history_response = client.get(f"/chat/history?project_id={project['id']}")

    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 1
    assert history[0]["question"] == "Hi"
    assert "finance-focused Deep Agent" in history[0]["answer"]
    assert history[0]["thread_id"] == chat_response.json()["thread_id"]
