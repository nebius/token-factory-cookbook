"""Experiment and run orchestration.

One experiment at a time (mutations to the demo namespace are serialized). Each run moves
through: setting_up → baseline_ready → detected → investigating → patch_proposed →
testing → applying → verifying → resolved | escalated | unresolved | blocked | cancelled.
Every step is an event in SQLite, so the UI can reconnect and replay.
"""
from __future__ import annotations

import json
import subprocess
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from kubernetes import client

from kubetrace_agent.executor import Executor, Mutation
from kubetrace_agent.k8s import agent_client
from kubetrace_agent.llm import FIXTURE_LABEL, FixtureModel, ModelError, OpenAICompatibleModel
from kubetrace_agent.loop import PROMPT_VERSION, Agent, Incident, Limits, Verification
from kubetrace_agent.redact import Redactor
from kubetrace_agent.sandbox import Runner
from kubetrace_agent.settings import ROOT, Settings
from kubetrace_agent.tools import TOOL_SCHEMA_VERSION, ToolContext
from kubetrace_agent.workspace import Workspace
from kubetrace_experiments.harness import Harness, HarnessError
from kubetrace_experiments.scenarios import SCENARIOS, Check, RunView, Scenario, checkout_checks

from .cluster import ClusterManager
from .db import Database

TERMINAL = {"resolved", "escalated", "unresolved", "blocked", "cancelled", "error"}


class RunError(Exception):
    pass


@dataclass
class Session:
    run_id: str
    scenario: Scenario
    harness: Harness
    run_dir: Path
    workspace: Workspace | None = None
    injected_commit: str = ""
    fault: dict = field(default_factory=dict)
    thread: threading.Thread | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    approvals: dict[str, tuple[threading.Event, dict]] = field(default_factory=dict)
    executor: Executor | None = None
    ctx: ToolContext | None = None


def repo_commit() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=5)
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        return (out.stdout.strip() or "uncommitted") + ("-dirty" if dirty else "")
    except OSError:
        return "unavailable"


class RunManager:
    def __init__(self, settings: Settings, db: Database, clusters: ClusterManager) -> None:
        self.settings, self.db, self.clusters = settings, db, clusters
        self.sessions: dict[str, Session] = {}
        self.lock = threading.Lock()
        self.redactor = Redactor(settings.secret_values())

    # Helpers ------------------------------------------------------------------------------------
    def emit(self, run_id: str, type_: str, payload: dict) -> dict:
        return self.db.append_event(run_id, type_, self.redactor.value(payload))

    def set_state(self, run_id: str, state: str) -> None:
        run = self.db.get_run(run_id)
        if run and run["state"] != state:
            self.db.update_run(run_id, state=state)
            self.emit(run_id, "state", {"state": state, "previous": run["state"]})
            if run["scenario_id"] in self.sessions:
                self.db.set_experiment(run["scenario_id"], state, run_id)

    def _busy(self, scenario_id: str) -> None:
        for sid, s in self.sessions.items():
            if s.thread and s.thread.is_alive():
                raise RunError(f"experiment {sid} is busy (run {s.run_id}); wait or reset it first")

    def _background(self, session: Session, target, *args) -> None:
        def wrapper():
            try:
                target(session, *args)
            except Exception as exc:  # noqa: BLE001 - every failure becomes a visible event
                self.emit(session.run_id, "error", {"where": target.__name__, "message": str(exc),
                                                    "trace": traceback.format_exc()[-3000:]})
                self.db.update_run(session.run_id, error=self.redactor.text(str(exc)), ended_at=time.time())
                self.set_state(session.run_id, "error")
        session.thread = threading.Thread(target=wrapper, daemon=True, name=f"run-{session.run_id}")
        session.thread.start()

    def _cluster_info(self, h: Harness) -> dict:
        status = self.clusters.status()
        try:
            capacity = h.node_capacity()
        except Exception as exc:  # noqa: BLE001
            capacity = {"error": str(exc)}
        return {"kind": self.settings.cluster_kind, "context": status.get("context"), "server": status.get("server"),
                "kubernetes_version": status.get("kubernetes_version"), "civo_cluster": status.get("civo_cluster"),
                "capacity": capacity, "namespace": self.settings.demo_namespace}

    # Setup ----------------------------------------------------------------------------------------
    def setup(self, scenario_id: str) -> str:
        scenario = SCENARIOS.get(scenario_id)
        if scenario is None:
            raise RunError(f"unknown scenario {scenario_id}")
        with self.lock:
            self._busy(scenario_id)
            handle = self.clusters.require()
            run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
            run_dir = self.settings.data_dir / "runs" / run_id
            run_dir.mkdir(parents=True, exist_ok=True)
            harness = Harness(self.settings, handle)
            self.db.create_run(id=run_id, scenario_id=scenario_id, provenance="pending", state="setting_up",
                               created_at=time.time(), repo_commit=repo_commit(), cluster=self._cluster_info(harness))
            # Only the newest session per scenario is kept; older runs stay in the database.
            for sid in list(self.sessions):
                if sid != scenario_id:
                    self.sessions.pop(sid)
            session = Session(run_id, scenario, harness, run_dir)
            self.sessions[scenario_id] = session
            self.db.set_experiment(scenario_id, "setting_up", run_id)
            self.emit(run_id, "state", {"state": "setting_up", "previous": None})
            self._background(session, self._do_setup)
        return run_id

    def _do_setup(self, s: Session) -> None:
        h, ns = s.harness, self.settings.demo_namespace
        ok, reason = s.scenario.capacity(h)
        if not ok:
            self.emit(s.run_id, "setup", {"step": "capacity", "ok": False, "detail": reason})
            self.db.update_run(s.run_id, error=f"skipped: {reason}", ended_at=time.time())
            self.set_state(s.run_id, "blocked")
            return
        step = lambda name, detail="": self.emit(s.run_id, "setup", {"step": name, "ok": True, "detail": detail})  # noqa: E731
        h.ensure_runner_image()
        step("runner image ready", self.settings.runner_image)
        for name in (ns, self.settings.partner_namespace):
            h.delete_namespace(name)
        step("previous experiment namespaces removed")
        h.ensure_namespace(ns, {"kubetrace.ai/demo": "true"})
        h.install_rbac()
        step("namespace and agent RBAC installed", f"{ns}: ServiceAccount kubetrace-agent with a namespace-scoped Role")
        image = h.baseline_image()
        step("baseline image ready", image)
        version = image.split(":")[-1].split("@")[0][:63] if ":" in image else "baseline"
        s.workspace = Workspace.create(s.run_dir / "workspace", {"STOREFRONT_IMAGE": image, "PROBE_IMAGE": image,
                                                                 "STOREFRONT_VERSION": f"baseline-{version}"[:63]})
        s.scenario.prepare(h, s.workspace)
        h.deploy_workspace(s.workspace)
        ok = h.wait_rollout("storefront", 240) and h.wait_rollout("probe", 120)
        checks = [Check("storefront and probe rolled out", ok, "Deployments available")]
        if ok:
            h.wait_for(lambda: h.http("storefront", "/healthz").get("status") == 200, 60)
            checks += checkout_checks(h)
        self.emit(s.run_id, "baseline", {"checks": [c.as_dict() for c in checks], "workspace_commit": s.workspace.head()})
        if not all(c.ok for c in checks):
            raise HarnessError("the healthy baseline did not come up; see the baseline checks")
        self.set_state(s.run_id, "baseline_ready")

    # Inject ---------------------------------------------------------------------------------------
    def inject(self, scenario_id: str) -> str:
        s = self._session(scenario_id, expect="baseline_ready")
        self._background(s, self._do_inject)
        return s.run_id

    def _do_inject(self, s: Session) -> None:
        self.set_state(s.run_id, "injecting")
        s.fault = s.scenario.inject(s.harness, s.workspace)
        s.injected_commit = s.workspace.head()
        self.emit(s.run_id, "fault_injected", {"scenario": s.scenario.id, "failure": s.scenario.failure})
        checks = s.scenario.fault_present(s.harness)
        self.emit(s.run_id, "detected", {"symptom": s.scenario.symptom, "incident": s.scenario.incident_title,
                                         "fault_proof": [c.as_dict() for c in checks]})
        if not all(c.ok for c in checks):
            raise HarnessError("the fault did not manifest; the experiment cannot start")
        self.set_state(s.run_id, "detected")

    # Investigate ----------------------------------------------------------------------------------
    def investigate(self, scenario_id: str, policy_mode: str, model_mode: str) -> str:
        if policy_mode not in ("review", "auto") or model_mode not in ("live", "fixture"):
            raise RunError("policy_mode must be review|auto and model_mode live|fixture")
        s = self._session(scenario_id, expect="detected")
        if model_mode == "fixture":
            model = FixtureModel(s.scenario.fixture())
            provenance = "fixture"
        else:
            try:
                model = OpenAICompatibleModel(self.settings)
            except ModelError as exc:
                raise RunError(f"live model unavailable: {exc}") from exc
            provenance = "civo-live" if self.settings.cluster_kind == "civo" else "local-live"
        self.db.update_run(s.run_id, provenance=provenance, provider=model.provider, model=model.model,
                           policy_mode=policy_mode, started_at=time.time())
        self._background(s, self._do_investigate, model, policy_mode)
        return s.run_id

    def _do_investigate(self, s: Session, model, policy_mode: str) -> None:
        run_id, settings = s.run_id, self.settings
        h = s.harness
        api = agent_client(h.cluster, settings.demo_namespace)
        s.executor = Executor(api, settings.demo_namespace, policy_mode, approver=lambda m: self._await_approval(s, m))
        s.ctx = ToolContext(settings=settings, namespace=settings.demo_namespace, api=api, executor=s.executor,
                            workspace=s.workspace, runner=Runner(settings), builder=h.builder, redactor=self.redactor,
                            run_dir=s.run_dir, emit=lambda t, p: self.emit(run_id, t, p),
                            set_state=lambda st: self.set_state(run_id, st), deployed_commit=s.injected_commit)
        limits = Limits(max_steps=min(settings.max_agent_steps, s.scenario.max_steps),
                        max_seconds=min(settings.max_run_seconds, s.scenario.max_seconds),
                        max_tokens=settings.max_run_tokens, max_output_chars=settings.max_tool_output_chars,
                        verification_retries=settings.verification_retries)
        run_settings = {"prompt_version": PROMPT_VERSION, "tool_schema_version": TOOL_SCHEMA_VERSION,
                        "generation_settings": model.generation_settings(), "limits": limits.__dict__,
                        "policy_mode": policy_mode, "test_runner": settings.test_runner,
                        "fixture_label": FIXTURE_LABEL if model.provider == "fixture" else None}
        self.db.update_run(run_id, settings=run_settings)
        incident = Incident(s.scenario.id, s.scenario.incident_title, s.scenario.incident_description, settings.demo_namespace)

        def verify(outcome: dict) -> Verification:
            view = RunView(workspace=s.workspace, injected_commit=s.injected_commit, mutations=s.executor.history,
                           builds=s.ctx.builds, agent_outcome=outcome, runner=s.ctx.runner, run_dir=s.run_dir, fault=s.fault)
            try:
                return s.scenario.verify(h, view)
            except Exception as exc:  # noqa: BLE001
                return Verification(False, [{"name": "verification ran", "ok": False, "detail": f"{type(exc).__name__}: {exc}"}],
                                    "Recovery could not be confirmed.")

        agent = Agent(model, s.ctx, incident, limits, self.redactor, verify, s.cancel,
                      emit=lambda t, p: self.emit(run_id, t, p), set_state=lambda st: self.set_state(run_id, st))
        result = agent.run()
        drift = self.drift(s)
        if drift:
            self.emit(run_id, "drift", {"differences": drift})
        transcript_path = s.run_dir / "transcript.json"
        transcript_path.write_text(json.dumps(self.redactor.value(result.transcript), indent=1, default=str))
        outcome = {"final_state": result.final_state, "reason": result.reason, "agent": result.agent_outcome,
                   "verifications": result.verifications, "drift": drift,
                   "mutations": [m.public() for m in s.executor.history], "builds": s.ctx.builds,
                   "tests": [{k: v for k, v in t.items() if k != "workspace_diff"} for t in s.ctx.test_runs],
                   "source_diff": s.workspace.diff_between(s.injected_commit) if s.workspace else "",
                   "injected_commit": s.injected_commit, "final_commit": s.workspace.head() if s.workspace else None,
                   "elapsed_s": result.elapsed_s}
        self.db.update_run(run_id, metrics=result.metrics, outcome=self.redactor.value(outcome), ended_at=time.time(),
                           first_attempt_success=None if result.first_attempt_success is None else int(result.first_attempt_success),
                           eventual_success=int(result.eventual_success))
        self.emit(run_id, "final", {"state": result.final_state, "reason": result.reason, "metrics": result.metrics})

    def _await_approval(self, s: Session, m: Mutation) -> tuple[bool, str]:
        event = threading.Event()
        decision: dict[str, Any] = {}
        s.approvals[m.id] = (event, decision)
        deadline = time.monotonic() + 900
        while not event.wait(1):
            if s.cancel.is_set() or time.monotonic() > deadline:
                return False, "cancelled" if s.cancel.is_set() else "approval timed out"
        self.emit(s.run_id, "approval", {"mutation_id": m.id, "approved": decision.get("approved"), "note": decision.get("note", "")})
        return bool(decision.get("approved")), decision.get("note", "")

    def approve(self, run_id: str, mutation_id: str, approved: bool, note: str) -> None:
        s = next((s for s in self.sessions.values() if s.run_id == run_id), None)
        if not s or mutation_id not in s.approvals:
            raise RunError("no pending approval with that id")
        event, decision = s.approvals.pop(mutation_id)
        decision.update(approved=approved, note=note)
        event.set()

    def cancel(self, run_id: str) -> None:
        s = next((s for s in self.sessions.values() if s.run_id == run_id), None)
        if not s:
            raise RunError("run is not active")
        s.cancel.set()
        self.emit(run_id, "cancel_requested", {})

    def reset(self, scenario_id: str) -> None:
        s = self.sessions.get(scenario_id)
        if s:
            s.cancel.set()
            if s.thread and s.thread.is_alive():
                s.thread.join(timeout=30)
            run = self.db.get_run(s.run_id)
            if run and run["state"] not in TERMINAL:
                self.set_state(s.run_id, "cancelled")
        h = Harness(self.settings, self.clusters.require())
        for name in (self.settings.demo_namespace, self.settings.partner_namespace):
            h.delete_namespace(name)
        self.sessions.pop(scenario_id, None)
        self.db.set_experiment(scenario_id, "idle", None)

    def run_all(self, scenario_id: str, policy_mode: str, model_mode: str) -> str:
        """Setup, inject and investigate in one go (used by scripts and the e2e test)."""
        run_id = self.setup(scenario_id)

        def chain():
            s = self.sessions[scenario_id]
            for stage, want in ((None, "baseline_ready"), ("inject", "detected")):
                if stage:
                    self.inject(scenario_id)
                while True:
                    time.sleep(1)
                    run = self.db.get_run(run_id)
                    if run["state"] == want and not (s.thread and s.thread.is_alive()):
                        break
                    if run["state"] in TERMINAL:
                        return
            self.investigate(scenario_id, policy_mode, model_mode)
        threading.Thread(target=chain, daemon=True).start()
        return run_id

    def _session(self, scenario_id: str, expect: str) -> Session:
        s = self.sessions.get(scenario_id)
        if not s:
            raise RunError("set up this experiment first")
        if s.thread and s.thread.is_alive():
            raise RunError("the experiment is busy")
        run = self.db.get_run(s.run_id)
        if run["state"] != expect:
            raise RunError(f"the experiment is in state {run['state']}; expected {expect}")
        return s

    # Drift ----------------------------------------------------------------------------------------
    def drift(self, s: Session) -> list[dict]:
        """Differences between the workspace manifests and the live objects, on fields that matter."""
        if not s.workspace:
            return []
        h, out = s.harness, []
        try:
            svc_m = yaml.safe_load(s.workspace.read("k8s/service.yaml"))
            live_svc = h.core.read_namespaced_service("storefront", h.ns)
            if (svc_m["spec"].get("selector") or {}) != (live_svc.spec.selector or {}):
                out.append({"field": "Service selector", "source": svc_m["spec"].get("selector"), "live": live_svc.spec.selector})
            dep_m = yaml.safe_load(s.workspace.read("k8s/deployment.yaml"))["spec"]["template"]["spec"]["containers"][0]
            live_c = h.deployment()["spec"]["template"]["spec"]["containers"][0]
            for key in ("image", "readinessProbe", "livenessProbe"):
                a, b = dep_m.get(key), live_c.get(key)
                if key != "image" and isinstance(a, dict) and isinstance(b, dict):
                    b = {k: v for k, v in b.items() if k in a}
                    if isinstance(b.get("httpGet"), dict):
                        b["httpGet"] = {k: v for k, v in b["httpGet"].items() if k in (a.get("httpGet") or {})}
                if a != b:
                    out.append({"field": f"Deployment {key}", "source": a, "live": b})
            lim_m = (dep_m.get("resources") or {}).get("limits", {}).get("memory")
            lim_l = (live_c.get("resources") or {}).get("limits", {}).get("memory")
            if lim_m != lim_l:
                out.append({"field": "Deployment memory limit", "source": lim_m, "live": lim_l})
            cm_m = json.loads(yaml.safe_load(s.workspace.read("k8s/configmap.yaml"))["data"]["config.json"])
            cm_l = json.loads(h.core.read_namespaced_config_map("storefront-config", h.ns).data["config.json"])
            if cm_m != cm_l:
                out.append({"field": "ConfigMap config.json", "source": cm_m, "live": cm_l})
        except Exception as exc:  # noqa: BLE001
            out.append({"field": "drift check", "error": str(exc)})
        return out

    def experiment_states(self) -> dict:
        states = self.db.experiments()
        for sid, s in self.sessions.items():
            run = self.db.get_run(s.run_id)
            states[sid] = {"state": run["state"], "run_id": s.run_id, "busy": bool(s.thread and s.thread.is_alive()),
                           "pending_approvals": list(s.approvals)}
        return states
