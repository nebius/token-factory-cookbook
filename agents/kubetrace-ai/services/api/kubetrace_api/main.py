"""KubeTrace AI HTTP API. Binds to localhost by default; see docs/SECURITY.md before exposing it."""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from kubetrace_agent.llm import preflight
from kubetrace_agent.settings import ROOT, get_settings
from kubetrace_experiments.harness import HarnessError
from kubetrace_experiments.scenarios import SCENARIOS

from . import reports
from .cluster import CivoClient, ClusterManager, ConnectionError_
from .db import Database
from .runs import TERMINAL, RunError, RunManager

settings = get_settings()
db = Database(settings.database_path)
clusters = ClusterManager(settings)
manager = RunManager(settings, db, clusters)
app = FastAPI(title="KubeTrace AI", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
API_TOKEN = os.environ.get("KUBETRACE_API_TOKEN", "")


@app.middleware("http")
async def token_guard(request: Request, call_next):
    # Optional shared token for anything beyond localhost. EventSource cannot send headers, so ?token= is accepted.
    # Authorize the path used by the router. request.url is reconstructed from
    # the untrusted Host header and must not decide whether a route is protected.
    path = request.scope["path"]
    if API_TOKEN and path.startswith("/api/") and path != "/api/health":
        supplied = request.headers.get("authorization", "").removeprefix("Bearer ").strip() or request.query_params.get("token", "")
        if supplied != API_TOKEN:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


@app.on_event("startup")
def connect_on_start() -> None:
    try:
        if settings.cluster_kind == "civo" and settings.civo_cluster_id and settings.civo_api_key:
            clusters.connect_civo(settings.civo_cluster_id, settings.civo_region)
        else:
            clusters.connect_kubeconfig()
    except Exception as exc:  # noqa: BLE001 - the UI shows the connection error
        clusters.error = str(exc)


def fail(exc: Exception, status: int = 400):
    raise HTTPException(status, manager.redactor.text(str(exc)))


# Health, provider ------------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"ok": True, "time": time.time()}


@app.get("/api/config")
def public_config():
    return {"model": settings.nebius_model or None, "base_url": settings.nebius_base_url, "policy_mode": settings.policy_mode,
            "cluster_kind": settings.cluster_kind, "demo_namespace": settings.demo_namespace,
            "limits": {"max_agent_steps": settings.max_agent_steps, "max_run_seconds": settings.max_run_seconds,
                       "max_run_tokens": settings.max_run_tokens},
            "model_configured": bool(settings.nebius_api_key and settings.nebius_model),
            "civo_configured": bool(settings.civo_api_key), "test_runner": settings.test_runner}


@app.get("/api/preflight")
def model_preflight():
    return manager.redactor.value(preflight(settings))


# Cluster ---------------------------------------------------------------------------------------
class ConnectRequest(BaseModel):
    source: str  # kubeconfig | civo
    context: str = ""
    cluster_id: str = ""
    region: str = ""


@app.get("/api/cluster")
def cluster_status():
    return clusters.status()


@app.post("/api/cluster/connect")
def cluster_connect(req: ConnectRequest):
    try:
        if req.source == "civo":
            return clusters.connect_civo(req.cluster_id, req.region or None)
        settings.cluster_kind = "kind" if "kind" in (req.context or "") or not req.context else settings.cluster_kind
        return clusters.connect_kubeconfig(req.context)
    except (ConnectionError_, Exception) as exc:  # noqa: BLE001
        fail(exc)


@app.get("/api/civo/clusters")
def civo_clusters(region: str = ""):
    try:
        return {"region": region or settings.civo_region, "clusters": CivoClient(settings).list_clusters(region or None)}
    except Exception as exc:  # noqa: BLE001
        fail(exc)


@app.get("/api/cluster/overview")
def overview(namespace: str = ""):
    try:
        return clusters.overview(namespace or None)
    except Exception as exc:  # noqa: BLE001
        fail(exc, 503)


@app.get("/api/cluster/topology")
def topology(namespace: str = ""):
    try:
        return clusters.topology(namespace or None)
    except Exception as exc:  # noqa: BLE001
        fail(exc, 503)


@app.get("/api/cluster/resource/{kind}/{namespace}/{name}")
def resource(kind: str, namespace: str, name: str):
    try:
        return manager.redactor.value(clusters.resource(kind, namespace, name))
    except Exception as exc:  # noqa: BLE001
        fail(exc, 404)


# Experiments -----------------------------------------------------------------------------------
class InvestigateRequest(BaseModel):
    policy_mode: str = "auto"
    model_mode: str = "live"


@app.get("/api/experiments")
def experiments():
    states = manager.experiment_states()
    return [{**s.card(), "status": states.get(s.id, {"state": "idle"})} for s in SCENARIOS.values()]


@app.post("/api/experiments/{scenario_id}/setup")
def experiment_setup(scenario_id: str):
    try:
        return {"run_id": manager.setup(scenario_id)}
    except (RunError, ConnectionError_, HarnessError) as exc:
        fail(exc, 409)


@app.post("/api/experiments/{scenario_id}/inject")
def experiment_inject(scenario_id: str):
    try:
        return {"run_id": manager.inject(scenario_id)}
    except RunError as exc:
        fail(exc, 409)


@app.post("/api/experiments/{scenario_id}/investigate")
def experiment_investigate(scenario_id: str, req: InvestigateRequest):
    try:
        return {"run_id": manager.investigate(scenario_id, req.policy_mode, req.model_mode)}
    except RunError as exc:
        fail(exc, 409)


@app.post("/api/experiments/{scenario_id}/run")
def experiment_run_all(scenario_id: str, req: InvestigateRequest):
    try:
        return {"run_id": manager.run_all(scenario_id, req.policy_mode, req.model_mode)}
    except (RunError, ConnectionError_) as exc:
        fail(exc, 409)


@app.post("/api/experiments/{scenario_id}/reset")
def experiment_reset(scenario_id: str):
    try:
        manager.reset(scenario_id)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        fail(exc, 409)


# Runs ------------------------------------------------------------------------------------------
class ApprovalRequest(BaseModel):
    approved: bool
    note: str = ""


@app.get("/api/runs")
def runs():
    return [{k: v for k, v in r.items() if k not in ("outcome",)} for r in db.list_runs()]


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str):
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "no such run")
    return run


@app.post("/api/runs/{run_id}/cancel")
def run_cancel(run_id: str):
    try:
        manager.cancel(run_id)
        return {"ok": True}
    except RunError as exc:
        fail(exc, 409)


@app.post("/api/runs/{run_id}/approvals/{mutation_id}")
def run_approve(run_id: str, mutation_id: str, req: ApprovalRequest):
    try:
        manager.approve(run_id, mutation_id, req.approved, req.note)
        return {"ok": True}
    except RunError as exc:
        fail(exc, 409)


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, request: Request, after: int = 0, follow: bool = True):
    """Server-sent events. Resumes after Last-Event-ID (or ?after=), replaying everything missed.
    follow=false returns once the backlog is sent (scripts and tests)."""
    if not db.get_run(run_id):
        raise HTTPException(404, "no such run")
    last = int(request.headers.get("last-event-id") or after or 0)

    async def stream():
        nonlocal last
        yield "retry: 2000\n\n"
        idle = 0.0
        while True:
            if await request.is_disconnected():
                return
            batch = db.events(run_id, last, 500)
            for e in batch:
                last = e["id"]
                yield f"id: {e['id']}\nevent: run\ndata: {json.dumps(e, default=str)}\n\n"
            if batch:
                idle = 0.0
                continue
            if not follow:
                return
            idle += 0.4
            if idle >= 15:
                idle = 0.0
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.4)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/runs/{run_id}/events.json")
def run_events_json(run_id: str, after: int = 0):
    return db.events(run_id, after, 100_000)


def _report(run_id: str, presentation: bool) -> dict:
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "no such run")
    return reports.build(run, db.events(run_id, 0, 100_000), reports.load_pricing(settings.pricing_file), presentation)


@app.get("/api/runs/{run_id}/report.json")
def report_json(run_id: str, presentation: bool = False):
    return _report(run_id, presentation)


@app.get("/api/runs/{run_id}/report.md", response_class=PlainTextResponse)
def report_md(run_id: str, presentation: bool = False):
    return reports.markdown(_report(run_id, presentation))


@app.get("/api/runs/{run_id}/export")
def export_run(run_id: str):
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "no such run")
    return {"format": "kubetrace-run-export/1", "run": run, "events": db.events(run_id, 0, 100_000)}


@app.post("/api/runs/import")
async def import_run(request: Request):
    data = await request.json()
    if data.get("format") != "kubetrace-run-export/1":
        raise HTTPException(400, "not a KubeTrace run export")
    src = data["run"]
    new_id = f"replay-{src['id']}-{uuid.uuid4().hex[:4]}"
    fields = {k: src.get(k) for k in ("scenario_id", "provider", "model", "policy_mode", "state", "created_at", "started_at",
                                      "ended_at", "repo_commit", "cluster", "settings", "metrics", "outcome",
                                      "first_attempt_success", "eventual_success", "error")}
    db.create_run(id=new_id, provenance="replay", replay_of=src.get("replay_of") or src.get("provenance"), **fields)
    for e in data["events"]:
        db.append_event(new_id, e["type"], {**e["payload"], "_original_ts": e["ts"]})
    return {"run_id": new_id, "replay_of": src.get("provenance")}


@app.get("/api/results")
def results():
    """Aggregate table from recorded runs only, separated by provenance. Every attempt counts."""
    rows: dict[tuple, dict] = {}
    for r in db.list_runs(10_000):
        if r["provenance"] in ("pending", "replay") or r["state"] not in TERMINAL:
            continue
        key = (r["provenance"], r["scenario_id"], r.get("model"))
        row = rows.setdefault(key, {"provenance": key[0], "scenario_id": key[1], "model": key[2], "runs": 0,
                                    "first_attempt_success": 0, "eventual_success": 0, "states": {}, "elapsed_s": [],
                                    "tokens": [], "run_ids": []})
        row["runs"] += 1
        row["first_attempt_success"] += int(bool(r.get("first_attempt_success")))
        row["eventual_success"] += int(bool(r.get("eventual_success")))
        row["states"][r["state"]] = row["states"].get(r["state"], 0) + 1
        out = r.get("outcome") or {}
        if out.get("elapsed_s") is not None:
            row["elapsed_s"].append(out["elapsed_s"])
        m = r.get("metrics") or {}
        if m.get("token_usage") == "reported by provider":
            row["tokens"].append(m.get("total_tokens"))
        row["run_ids"].append(r["id"])
    return sorted(rows.values(), key=lambda x: (x["provenance"], x["scenario_id"]))


# Frontend --------------------------------------------------------------------------------------
WEB_DIST = ROOT / "apps" / "web" / "dist"


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if not WEB_DIST.exists():
        return PlainTextResponse("Frontend not built. Run the Vite dev server (apps/web) or `pnpm build`.", status_code=404)
    candidate = (WEB_DIST / path).resolve()
    if path and WEB_DIST.resolve() in candidate.parents and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(WEB_DIST / "index.html")
