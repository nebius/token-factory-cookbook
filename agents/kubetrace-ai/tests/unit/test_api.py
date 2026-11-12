"""API: SSE replay after reconnect, export/import provenance, results separation."""
import json
import time

import pytest


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("KUBECONFIG", str(tmp_path / "none"))
    from kubetrace_agent import settings as settings_module
    settings_module.reset_settings(data_dir=tmp_path, database_path=tmp_path / "t.db")
    import importlib
    from kubetrace_api import main
    importlib.reload(main)
    return main


def seed(main, run_id="r1", provenance="local-live", n=5):
    main.db.create_run(id=run_id, scenario_id="selector-mismatch", provenance=provenance, state="resolved", created_at=time.time(),
                       model="m", eventual_success=1, first_attempt_success=1, outcome={"elapsed_s": 3})
    return [main.db.append_event(run_id, "observation", {"text": f"e{i}"})["id"] for i in range(n)]


def read_sse(client, url, headers=None, want=3):
    got = []
    with client.stream("GET", url, headers=headers or {}) as resp:
        for line in resp.iter_lines():
            if line.startswith("data: "):
                got.append(json.loads(line[6:]))
                if len(got) >= want:
                    break
    return got


def test_sse_resumes_after_last_event_id(app):
    from fastapi.testclient import TestClient
    ids = seed(app)
    client = TestClient(app.app)
    first = read_sse(client, "/api/runs/r1/events?follow=false", want=2)
    assert [e["id"] for e in first] == ids[:2]
    resumed = read_sse(client, "/api/runs/r1/events?follow=false", headers={"Last-Event-ID": str(ids[1])}, want=3)
    assert [e["id"] for e in resumed] == ids[2:]


def test_export_import_keeps_provenance_and_model(app):
    from fastapi.testclient import TestClient
    seed(app, provenance="civo-live")
    client = TestClient(app.app)
    exported = client.get("/api/runs/r1/export").json()
    imported = client.post("/api/runs/import", json=exported).json()
    run = client.get(f"/api/runs/{imported['run_id']}").json()
    assert run["provenance"] == "replay" and run["replay_of"] == "civo-live" and run["model"] == "m"
    assert len(client.get(f"/api/runs/{imported['run_id']}/events.json").json()) == 5


def test_results_keep_provenances_apart_and_skip_replays(app):
    from fastapi.testclient import TestClient
    seed(app, "a", "fixture")
    seed(app, "b", "civo-live")
    client = TestClient(app.app)
    exported = client.get("/api/runs/b/export").json()
    client.post("/api/runs/import", json=exported)
    rows = client.get("/api/results").json()
    assert sorted(r["provenance"] for r in rows) == ["civo-live", "fixture"]


@pytest.mark.parametrize("host", [
    "localhost",
    "localhost/not-api?ignored=",
    "localhost/api/health?ignored=",
    "localhost#ignored",
])
def test_token_guard_cannot_be_bypassed_with_host_header(app, monkeypatch, host):
    from fastapi.testclient import TestClient
    monkeypatch.setattr(app, "API_TOKEN", "test-token")
    client = TestClient(app.app)
    assert client.get("/api/config", headers={"host": host}).status_code == 401


@pytest.mark.parametrize("auth", [
    {"headers": {"authorization": "Bearer test-token"}},
    {"params": {"token": "test-token"}},
])
def test_token_guard_accepts_header_and_eventsource_token(app, monkeypatch, auth):
    from fastapi.testclient import TestClient
    monkeypatch.setattr(app, "API_TOKEN", "test-token")
    client = TestClient(app.app)
    assert client.get("/api/config", **auth).status_code == 200
    assert client.get("/api/health").status_code == 200
