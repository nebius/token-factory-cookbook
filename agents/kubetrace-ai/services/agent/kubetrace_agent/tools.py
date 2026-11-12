"""Typed, bounded tools for the agent.

Every tool has a Pydantic argument model (its JSON schema is what the model sees), runs
through the namespace-scoped agent client, and returns structured output that is
redacted and size-limited before the model or the UI sees it. Changes to the cluster go
through the Executor, never straight to the API.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

import yaml
from kubernetes import client
from kubernetes.client.rest import ApiException
from pydantic import BaseModel, Field, ValidationError

from .executor import ExecutionError, Executor, Mutation
from .k8s import list_endpoint_slices, read_endpoint_slice, sanitize
from .redact import Redactor, truncate
from .sandbox import BuildError, ImageBuilder, Runner
from .settings import Settings
from .workspace import Workspace, WorkspaceError

PROBE_SERVICE = "probe"


@dataclass
class ToolContext:
    settings: Settings
    namespace: str
    api: client.ApiClient            # agent ServiceAccount client
    executor: Executor
    workspace: Workspace
    runner: Runner
    builder: ImageBuilder
    redactor: Redactor
    run_dir: Path
    emit: Callable[[str, dict], None]
    set_state: Callable[[str], None]
    write_attempts: int = 0
    file_edits: int = 0
    builds: list[dict] = field(default_factory=list)
    test_runs: list[dict] = field(default_factory=list)
    finished: dict | None = None
    deployed_commit: str = ""


class ToolFailure(Exception):
    """An expected failure the model should see and can react to."""


# --------------------------------------------------------------------------------------------
# Argument models
# --------------------------------------------------------------------------------------------
class ListResources(BaseModel):
    """List resources of one kind in the incident namespace, with a short status for each."""
    kind: Literal["pods", "deployments", "replicasets", "services", "endpointslices", "configmaps"]


class GetResource(BaseModel):
    """Read one resource's specification and status as YAML."""
    kind: Literal["Pod", "Deployment", "ReplicaSet", "Service", "EndpointSlice", "ConfigMap"]
    name: str = Field(max_length=253)


class GetEvents(BaseModel):
    """Recent Kubernetes events in the namespace, newest first, optionally for one object."""
    involved_object: str | None = Field(default=None, description="Name of a Pod, Deployment, ReplicaSet or Service")
    limit: int = Field(default=30, ge=1, le=80)


class GetLogs(BaseModel):
    """Tail a container's logs. Use previous=true for the last crashed instance."""
    pod: str = Field(max_length=253)
    container: str | None = None
    previous: bool = False
    tail_lines: int = Field(default=120, ge=1, le=400)


class RolloutStatus(BaseModel):
    """Deployment rollout state: replica counts, conditions, ReplicaSets and Pod states."""
    deployment: str


class ServiceEndpoints(BaseModel):
    """A Service's selector and ports, its EndpointSlices, and which Pods its selector matches."""
    service: str


class HttpCheck(BaseModel):
    """Send one HTTP request to a Service from the in-cluster probe Pod (a real request through the Service)."""
    service: str
    path: str = Field(default="/", max_length=200)
    method: Literal["GET", "POST"] = "GET"
    json_body: dict | list | None = Field(default=None, description="JSON body for POST")
    port: int = Field(default=80, ge=1, le=65535)


class ListFiles(BaseModel):
    """List files in the application workspace (source, tests, docs, manifests), marking which are writable."""


class ReadFile(BaseModel):
    """Read a workspace file, optionally a line range."""
    path: str
    start_line: int | None = Field(default=None, ge=1)
    end_line: int | None = Field(default=None, ge=1)


class Note(BaseModel):
    """Record a concise observation or hypothesis for the incident timeline, citing the evidence."""
    kind: Literal["observation", "hypothesis"]
    text: str = Field(max_length=600)
    evidence: list[str] = Field(default_factory=list, description="Short references to tool results that support it")


class EditFile(BaseModel):
    """Replace one exact snippet in a writable workspace file. old_text must match exactly once."""
    path: str
    old_text: str = Field(min_length=1)
    new_text: str
    reason: str = Field(max_length=300)


class WriteFile(BaseModel):
    """Create or overwrite a writable workspace file, for example a new test module."""
    path: str
    content: str
    reason: str = Field(max_length=300)


class ShowDiff(BaseModel):
    """Unified diff of the workspace against what is currently deployed."""


class RunTests(BaseModel):
    """Run the workspace's tests or lint in a disposable sandbox with no network."""
    suite: Literal["unit", "lint"] = "unit"


class BuildImage(BaseModel):
    """Build a new immutable image from the current workspace. Run the unit tests first."""
    reason: str = Field(max_length=300)


class ApplyManifest(BaseModel):
    """Apply a workspace manifest (k8s/deployment.yaml, k8s/service.yaml or k8s/configmap.yaml) to the cluster.
    Edit the file first; the executor dry-runs it, checks policy and writes it with a staleness check."""
    path: Literal["k8s/deployment.yaml", "k8s/service.yaml", "k8s/configmap.yaml"]
    reason: str = Field(max_length=300)


class PatchResource(BaseModel):
    """Patch a live resource. Maps merge; null deletes a key; lists of named items (containers, env, ports) merge
    by name, so {"spec":{"template":{"spec":{"containers":[{"name":"storefront","resources":{...}}]}}}} changes only
    that field. Prefer apply_manifest, which keeps the source of truth in sync; a live patch must be reconciled into
    the manifest afterwards."""
    kind: Literal["Deployment", "Service", "ConfigMap"]
    name: str
    patch: dict
    reason: str = Field(max_length=300)


class DeployImage(BaseModel):
    """Roll the storefront Deployment to an image produced by build_image in this run."""
    image: str
    reason: str = Field(max_length=300)


class RestartRollout(BaseModel):
    """Restart a Deployment's Pods (a rollout), for example so they reread a ConfigMap."""
    deployment: str
    reason: str = Field(max_length=300)


class WaitForRollout(BaseModel):
    """Wait until a Deployment's rollout completes or the timeout passes."""
    deployment: str
    timeout_s: int = Field(default=120, ge=5, le=240)


class RevertChange(BaseModel):
    """Revert a change this run applied, if the resource has not changed since."""
    change_id: str
    reason: str = Field(max_length=300)


class Finish(BaseModel):
    """End the investigation. Use outcome=resolved only after your own checks show recovery; use escalate when
    the cause is outside your allowed scope or you cannot fix it safely."""
    outcome: Literal["resolved", "escalate"]
    root_cause: str = Field(max_length=800)
    summary: str = Field(max_length=1500)
    evidence: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------------------------
# Implementations
# --------------------------------------------------------------------------------------------
def _core(ctx: ToolContext) -> client.CoreV1Api:
    return client.CoreV1Api(ctx.api)


def _apps(ctx: ToolContext) -> client.AppsV1Api:
    return client.AppsV1Api(ctx.api)


def _age(ts) -> str | None:
    return ts.isoformat() if ts else None


def _pod_summary(pod) -> dict:
    statuses = []
    for cs in pod.status.container_statuses or []:
        state = cs.state
        current = ("running" if state.running else f"waiting: {state.waiting.reason}" if state.waiting
                   else f"terminated: {state.terminated.reason}" if state.terminated else "unknown")
        last = cs.last_state.terminated if cs.last_state else None
        statuses.append({"container": cs.name, "ready": cs.ready, "restarts": cs.restart_count, "state": current,
                         "last_terminated": {"reason": last.reason, "exit_code": last.exit_code} if last else None,
                         "image": cs.image})
    return {"name": pod.metadata.name, "phase": pod.status.phase, "labels": pod.metadata.labels or {},
            "owner": (pod.metadata.owner_references or [None])[0] and pod.metadata.owner_references[0].name,
            "containers": statuses,
            "conditions": {c.type: c.status for c in pod.status.conditions or []}}


def list_resources(ctx: ToolContext, a: ListResources) -> dict:
    ns = ctx.namespace
    if a.kind == "pods":
        return {"pods": [_pod_summary(p) for p in _core(ctx).list_namespaced_pod(ns).items]}
    if a.kind == "deployments":
        return {"deployments": [{"name": d.metadata.name, "replicas": d.spec.replicas,
                                 "ready": d.status.ready_replicas or 0, "updated": d.status.updated_replicas or 0,
                                 "images": [c.image for c in d.spec.template.spec.containers]}
                                for d in _apps(ctx).list_namespaced_deployment(ns).items]}
    if a.kind == "replicasets":
        return {"replicasets": [{"name": r.metadata.name, "replicas": r.spec.replicas, "ready": r.status.ready_replicas or 0,
                                 "revision": (r.metadata.annotations or {}).get("deployment.kubernetes.io/revision"),
                                 "images": [c.image for c in r.spec.template.spec.containers]}
                                for r in _apps(ctx).list_namespaced_replica_set(ns).items]}
    if a.kind == "services":
        return {"services": [{"name": s.metadata.name, "type": s.spec.type, "selector": s.spec.selector or {},
                              "ports": [{"port": p.port, "targetPort": p.target_port, "name": p.name} for p in s.spec.ports or []]}
                             for s in _core(ctx).list_namespaced_service(ns).items]}
    if a.kind == "endpointslices":
        slices = list_endpoint_slices(ctx.api, ns)
        return {"endpointslices": [{"name": e["metadata"]["name"],
                                    "service": (e["metadata"].get("labels") or {}).get("kubernetes.io/service-name"),
                                    "endpoints": [{"addresses": ep.get("addresses"), "ready": (ep.get("conditions") or {}).get("ready"),
                                                   "pod": (ep.get("targetRef") or {}).get("name")} for ep in e.get("endpoints") or []]}
                                   for e in slices]}
    return {"configmaps": [{"name": c.metadata.name, "keys": sorted((c.data or {}).keys())}
                           for c in _core(ctx).list_namespaced_config_map(ns).items]}


def get_resource(ctx: ToolContext, a: GetResource) -> dict:
    ns, core, apps = ctx.namespace, _core(ctx), _apps(ctx)
    readers = {"Pod": lambda: core.read_namespaced_pod(a.name, ns),
               "Deployment": lambda: apps.read_namespaced_deployment(a.name, ns),
               "ReplicaSet": lambda: apps.read_namespaced_replica_set(a.name, ns),
               "Service": lambda: core.read_namespaced_service(a.name, ns),
               "EndpointSlice": lambda: read_endpoint_slice(ctx.api, ns, a.name),
               "ConfigMap": lambda: core.read_namespaced_config_map(a.name, ns)}
    return {"yaml": yaml.safe_dump(sanitize(readers[a.kind]()), sort_keys=False)}


def get_events(ctx: ToolContext, a: GetEvents) -> dict:
    events = _core(ctx).list_namespaced_event(ctx.namespace).items
    if a.involved_object:
        events = [e for e in events if e.involved_object and a.involved_object in (e.involved_object.name or "")]
    events.sort(key=lambda e: (e.last_timestamp or e.event_time or e.metadata.creation_timestamp), reverse=True)
    return {"events": [{"type": e.type, "reason": e.reason, "object": f"{e.involved_object.kind}/{e.involved_object.name}",
                        "message": e.message, "count": e.count, "last_seen": _age(e.last_timestamp or e.event_time)}
                       for e in events[: a.limit]]}


def get_logs(ctx: ToolContext, a: GetLogs) -> dict:
    try:
        text = _core(ctx).read_namespaced_pod_log(a.pod, ctx.namespace, container=a.container, previous=a.previous,
                                                   tail_lines=a.tail_lines, limit_bytes=60_000)
    except ApiException as exc:
        raise ToolFailure(f"logs unavailable: {_api_message(exc)}") from exc
    return {"pod": a.pod, "previous": a.previous, "log": text}


def rollout_status(ctx: ToolContext, a: RolloutStatus) -> dict:
    d = _apps(ctx).read_namespaced_deployment(a.deployment, ctx.namespace)
    selector = ",".join(f"{k}={v}" for k, v in (d.spec.selector.match_labels or {}).items())
    pods = _core(ctx).list_namespaced_pod(ctx.namespace, label_selector=selector).items
    rs = [r for r in _apps(ctx).list_namespaced_replica_set(ctx.namespace, label_selector=selector).items
          if any(o.name == d.metadata.name for o in r.metadata.owner_references or [])]
    complete = (d.status.updated_replicas == d.spec.replicas and d.status.ready_replicas == d.spec.replicas
                and (d.status.observed_generation or 0) >= d.metadata.generation and not (d.status.unavailable_replicas or 0))
    return {"deployment": a.deployment, "generation": d.metadata.generation, "observed_generation": d.status.observed_generation,
            "replicas": d.spec.replicas, "updated": d.status.updated_replicas or 0, "ready": d.status.ready_replicas or 0,
            "available": d.status.available_replicas or 0, "unavailable": d.status.unavailable_replicas or 0,
            "rollout_complete": bool(complete),
            "conditions": [{"type": c.type, "status": c.status, "reason": c.reason, "message": c.message}
                           for c in d.status.conditions or []],
            "replicasets": [{"name": r.metadata.name, "revision": (r.metadata.annotations or {}).get("deployment.kubernetes.io/revision"),
                             "replicas": r.status.replicas or 0, "ready": r.status.ready_replicas or 0,
                             "image": r.spec.template.spec.containers[0].image} for r in rs],
            "pods": [_pod_summary(p) for p in pods]}


def service_endpoints(ctx: ToolContext, a: ServiceEndpoints) -> dict:
    svc = _core(ctx).read_namespaced_service(a.service, ctx.namespace)
    selector = svc.spec.selector or {}
    label_selector = ",".join(f"{k}={v}" for k, v in selector.items())
    matched = _core(ctx).list_namespaced_pod(ctx.namespace, label_selector=label_selector).items if selector else []
    slices = list_endpoint_slices(ctx.api, ctx.namespace, f"kubernetes.io/service-name={a.service}")
    all_pods = _core(ctx).list_namespaced_pod(ctx.namespace).items
    return {"service": a.service, "selector": selector,
            "ports": [{"port": p.port, "targetPort": p.target_port, "protocol": p.protocol} for p in svc.spec.ports or []],
            "pods_matching_selector": [{"name": p.metadata.name, "ready": (p.status.conditions and any(
                c.type == "Ready" and c.status == "True" for c in p.status.conditions)) or False} for p in matched],
            "endpoints": [{"address": (ep.get("addresses") or [None])[0], "ready": (ep.get("conditions") or {}).get("ready"),
                           "pod": (ep.get("targetRef") or {}).get("name")}
                          for s in slices for ep in s.get("endpoints") or []],
            "pod_labels_in_namespace": sorted({json.dumps(p.metadata.labels or {}, sort_keys=True) for p in all_pods})}


def http_check(ctx: ToolContext, a: HttpCheck) -> dict:
    target = f"http://{a.service}.{ctx.namespace}.svc:{a.port}{a.path if a.path.startswith('/') else '/' + a.path}"
    query = {"url": target, "method": a.method}
    if a.json_body is not None:
        query["body"] = json.dumps(a.json_body)
    path = f"/api/v1/namespaces/{ctx.namespace}/services/{PROBE_SERVICE}:80/proxy/probe?{urllib.parse.urlencode(query)}"
    started = time.monotonic()
    try:
        resp = ctx.api.call_api(path, "GET", auth_settings=["BearerToken"], response_type="str",
                                _preload_content=False, _request_timeout=15)[0]
        data = json.loads(resp.data)
    except ApiException as exc:
        raise ToolFailure(f"the in-cluster probe is unreachable: {_api_message(exc)}") from exc
    data["target"] = target
    data["probe_round_trip_ms"] = round((time.monotonic() - started) * 1000)
    if isinstance(data.get("body"), str):
        try:
            data["body"] = json.loads(data["body"])
        except ValueError:
            pass
    return data


def list_files(ctx: ToolContext, a: ListFiles) -> dict:
    return {"files": ctx.workspace.list_files()}


def read_file(ctx: ToolContext, a: ReadFile) -> dict:
    try:
        lines = ctx.workspace.read(a.path).splitlines()
    except WorkspaceError as exc:
        raise ToolFailure(str(exc)) from exc
    start = (a.start_line or 1) - 1
    end = a.end_line or len(lines)
    numbered = "\n".join(f"{i + 1:4d}  {line}" for i, line in enumerate(lines[start:end], start=start))
    return {"path": a.path, "lines": f"{start + 1}-{min(end, len(lines))} of {len(lines)}", "content": numbered}


def note(ctx: ToolContext, a: Note) -> dict:
    ctx.emit(a.kind, {"text": a.text, "evidence": a.evidence})
    return {"recorded": True}


def _after_edit(ctx: ToolContext, path: str, reason: str) -> dict:
    ctx.file_edits += 1
    if ctx.file_edits > 40:
        raise ToolFailure("file edit limit reached for this run")
    diff = ctx.workspace.diff(ctx.deployed_commit or "HEAD")
    ctx.set_state("patch_proposed")
    ctx.emit("patch_proposed", {"path": path, "reason": reason, "diff": diff})
    return {"edited": path, "workspace_diff": diff}


def edit_file(ctx: ToolContext, a: EditFile) -> dict:
    try:
        ctx.workspace.edit(a.path, a.old_text, a.new_text)
    except WorkspaceError as exc:
        raise ToolFailure(str(exc)) from exc
    return _after_edit(ctx, a.path, a.reason)


def write_file(ctx: ToolContext, a: WriteFile) -> dict:
    try:
        ctx.workspace.write(a.path, a.content)
    except WorkspaceError as exc:
        raise ToolFailure(str(exc)) from exc
    return _after_edit(ctx, a.path, a.reason)


def show_diff(ctx: ToolContext, a: ShowDiff) -> dict:
    return {"diff": ctx.workspace.diff(ctx.deployed_commit or "HEAD") or "(no changes)"}


def run_tests(ctx: ToolContext, a: RunTests) -> dict:
    ctx.set_state("testing")
    snap = ctx.workspace.snapshot(ctx.run_dir / "test-snapshots" / f"{len(ctx.test_runs) + 1:02d}")
    result = ctx.runner.run(snap, a.suite)
    record = {"suite": a.suite, "command": " ".join(result.command), "exit_code": result.exit_code,
              "passed": result.ok, "duration_s": round(result.duration_s, 2), "isolation": result.isolation,
              "output": truncate(result.output, 5000), "commit_of_tested_tree": ctx.workspace.head(),
              "workspace_diff": ctx.workspace.diff(ctx.deployed_commit or "HEAD")}
    ctx.test_runs.append(record)
    ctx.emit("test_result", record)
    return {k: record[k] for k in ("suite", "command", "exit_code", "passed", "duration_s", "isolation", "output")}


def build_image(ctx: ToolContext, a: BuildImage) -> dict:
    if not ctx.test_runs or not ctx.test_runs[-1]["passed"] or ctx.test_runs[-1]["suite"] != "unit":
        raise ToolFailure("run the unit tests and get them passing before building an image")
    if ctx.test_runs[-1]["workspace_diff"] != ctx.workspace.diff(ctx.deployed_commit or "HEAD"):
        raise ToolFailure("the workspace changed after the last passing test run; run the tests again")
    commit = ctx.workspace.commit(f"Agent change: {a.reason}")
    tag = f"{ctx.run_dir.name}-{commit[:8]}-b{len(ctx.builds) + 1}"
    snap = ctx.workspace.snapshot(ctx.run_dir / "build-context")
    try:
        built = ctx.builder.build(snap, tag)
    except BuildError as exc:
        raise ToolFailure(str(exc)) from exc
    ctx.executor.allowed_images.add(built.ref)
    record = {"image": built.ref, "tag": built.tag, "image_id": built.image_id, "digest": built.digest,
              "source_commit": commit, "duration_s": round(built.duration_s, 1)}
    ctx.builds.append(record)
    ctx.emit("image_built", {**record, "build_output_tail": truncate(built.build_output, 1500)})
    return record


def _mutate(ctx: ToolContext, kind: str, name: str, live: dict, proposed: dict, source: str, reason: str) -> Mutation:
    ctx.write_attempts += 1
    if ctx.write_attempts > ctx.settings.max_write_attempts:
        raise ToolFailure(f"write attempt limit ({ctx.settings.max_write_attempts}) reached")
    ctx.set_state("applying")

    def on_update(m: Mutation) -> None:
        if m.status in ("denied", "pending_approval", "rejected", "stale"):
            ctx.emit("policy_decision", m.public())
        elif m.status in ("applied", "failed"):
            ctx.emit("applied_change" if m.status == "applied" else "error", m.public())

    return ctx.executor.execute(kind, name, live, proposed, source, reason, on_update)


def _mutation_result(m: Mutation) -> dict:
    out = {"change_id": m.id, "status": m.status, "policy": m.decision, "diff": m.diff}
    if m.error:
        out["error"] = m.error
    if m.status == "stale":
        out["hint"] = "the resource changed since it was read; read it again and re-propose"
    return out


def apply_manifest(ctx: ToolContext, a: ApplyManifest) -> dict:
    try:
        manifest = yaml.safe_load(ctx.workspace.read(a.path))
        kind, name, live, proposed = ctx.executor.from_manifest(manifest)
    except (WorkspaceError, ExecutionError, yaml.YAMLError) as exc:
        raise ToolFailure(str(exc)) from exc
    except ApiException as exc:
        raise ToolFailure(_api_message(exc)) from exc
    m = _mutate(ctx, kind, name, live, proposed, "apply_manifest", a.reason)
    if m.status == "applied":
        ctx.deployed_commit = ctx.workspace.commit(f"Applied {a.path}: {a.reason}")
    return _mutation_result(m)


def patch_resource(ctx: ToolContext, a: PatchResource) -> dict:
    try:
        live, proposed = ctx.executor.from_merge_patch(a.kind, a.name, a.patch)
    except (ExecutionError, ApiException) as exc:
        raise ToolFailure(str(exc)) from exc
    m = _mutate(ctx, a.kind, a.name, live, proposed, "patch_resource", a.reason)
    out = _mutation_result(m)
    if m.status == "applied":
        out["reminder"] = "this was a live patch; update the matching file under k8s/ so the source stays in sync"
    return out


def _set_manifest_image(ctx: ToolContext, image: str) -> None:
    text = ctx.workspace.read("k8s/deployment.yaml")
    updated, count = re.subn(r"(?m)^(\s*image:\s*).+$", lambda m: m.group(1) + image, text, count=1)
    if count:
        ctx.workspace.write("k8s/deployment.yaml", updated)


def deploy_image(ctx: ToolContext, a: DeployImage) -> dict:
    if a.image not in ctx.executor.allowed_images:
        raise ToolFailure(f"{a.image} was not built in this run. Built: {sorted(ctx.executor.allowed_images) or 'none'}")
    patch = {"spec": {"template": {"spec": {"containers": [None]}}}}
    live = ctx.executor.read("Deployment", "storefront")
    containers = live["spec"]["template"]["spec"]["containers"]
    patch["spec"]["template"]["spec"]["containers"] = [
        {**c, "image": a.image, "env": [e if e.get("name") != "APP_VERSION" else {"name": "APP_VERSION", "value": a.image.split(":")[-1][:63]}
                                        for e in c.get("env") or []]} if c["name"] == "storefront" else c for c in containers]
    try:
        live, proposed = ctx.executor.from_merge_patch("Deployment", "storefront", patch)
    except (ExecutionError, ApiException) as exc:
        raise ToolFailure(str(exc)) from exc
    m = _mutate(ctx, "Deployment", "storefront", live, proposed, "deploy_image", a.reason)
    if m.status == "applied":
        _set_manifest_image(ctx, a.image)
        ctx.deployed_commit = ctx.workspace.commit(f"Deploy {a.image}")
    return _mutation_result(m)


def restart_rollout(ctx: ToolContext, a: RestartRollout) -> dict:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    patch = {"spec": {"template": {"metadata": {"annotations": {"kubectl.kubernetes.io/restartedAt": stamp}}}}}
    try:
        live, proposed = ctx.executor.from_merge_patch("Deployment", a.deployment, patch)
    except (ExecutionError, ApiException) as exc:
        raise ToolFailure(str(exc)) from exc
    return _mutation_result(_mutate(ctx, "Deployment", a.deployment, live, proposed, "restart_rollout", a.reason))


def wait_for_rollout(ctx: ToolContext, a: WaitForRollout) -> dict:
    deadline = time.monotonic() + a.timeout_s
    status = rollout_status(ctx, RolloutStatus(deployment=a.deployment))
    while not status["rollout_complete"] and time.monotonic() < deadline:
        time.sleep(3)
        status = rollout_status(ctx, RolloutStatus(deployment=a.deployment))
    status["waited_s"] = round(a.timeout_s - max(0.0, deadline - time.monotonic()), 1)
    status["timed_out"] = not status["rollout_complete"]
    ctx.emit("rollout", {"deployment": a.deployment, "complete": status["rollout_complete"], "waited_s": status["waited_s"],
                         "ready": status["ready"], "replicas": status["replicas"]})
    return status


def revert_change(ctx: ToolContext, a: RevertChange) -> dict:
    ctx.write_attempts += 1
    try:
        m = ctx.executor.revert(a.change_id, lambda m: ctx.emit("applied_change" if m.status == "applied" else "policy_decision",
                                                                 m.public()))
    except ExecutionError as exc:
        raise ToolFailure(str(exc)) from exc
    return _mutation_result(m)


def finish(ctx: ToolContext, a: Finish) -> dict:
    ctx.finished = a.model_dump()
    return {"recorded": True, "note": "the harness now verifies recovery independently"}


@dataclass
class Tool:
    name: str
    args: type[BaseModel]
    fn: Callable[[ToolContext, Any], dict]
    category: str  # read, code, remediation, control


TOOLS: list[Tool] = [
    Tool("list_resources", ListResources, list_resources, "read"),
    Tool("get_resource", GetResource, get_resource, "read"),
    Tool("get_events", GetEvents, get_events, "read"),
    Tool("get_logs", GetLogs, get_logs, "read"),
    Tool("rollout_status", RolloutStatus, rollout_status, "read"),
    Tool("service_endpoints", ServiceEndpoints, service_endpoints, "read"),
    Tool("http_check", HttpCheck, http_check, "read"),
    Tool("list_files", ListFiles, list_files, "read"),
    Tool("read_file", ReadFile, read_file, "read"),
    Tool("note", Note, note, "control"),
    Tool("edit_file", EditFile, edit_file, "code"),
    Tool("write_file", WriteFile, write_file, "code"),
    Tool("show_diff", ShowDiff, show_diff, "code"),
    Tool("run_tests", RunTests, run_tests, "code"),
    Tool("build_image", BuildImage, build_image, "code"),
    Tool("apply_manifest", ApplyManifest, apply_manifest, "remediation"),
    Tool("patch_resource", PatchResource, patch_resource, "remediation"),
    Tool("deploy_image", DeployImage, deploy_image, "remediation"),
    Tool("restart_rollout", RestartRollout, restart_rollout, "remediation"),
    Tool("wait_for_rollout", WaitForRollout, wait_for_rollout, "read"),
    Tool("revert_change", RevertChange, revert_change, "remediation"),
    Tool("finish", Finish, finish, "control"),
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}
TOOL_SCHEMA_VERSION = "2026-10-16.1"


def tool_schemas() -> list[dict]:
    schemas = []
    for t in TOOLS:
        params = t.args.model_json_schema()
        params.pop("title", None)
        description = (t.args.__doc__ or "").strip().replace("\n", " ")
        params.pop("description", None)
        schemas.append({"type": "function", "function": {"name": t.name, "description": description, "parameters": params}})
    return schemas


SLOW_TOOLS = {"build_image": 1200, "run_tests": 300, "wait_for_rollout": 300}
DEFAULT_TOOL_TIMEOUT_S = 90


def dispatch(ctx: ToolContext, name: str, raw_arguments: str) -> tuple[bool, dict]:
    """Run one tool call with a time limit. Returns (ok, structured result); never raises."""
    import concurrent.futures
    limit = SLOW_TOOLS.get(name, DEFAULT_TOOL_TIMEOUT_S)
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"tool-{name}")
    future = pool.submit(_dispatch, ctx, name, raw_arguments)
    try:
        return future.result(timeout=limit)
    except concurrent.futures.TimeoutError:
        return False, {"error": f"{name} did not finish within {limit} s and was abandoned; the cluster or a "
                                "dependency may be slow. Check state before retrying."}
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _dispatch(ctx: ToolContext, name: str, raw_arguments: str) -> tuple[bool, dict]:
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return False, {"error": f"unknown tool {name!r}", "available": sorted(TOOLS_BY_NAME)}
    try:
        args = tool.args.model_validate(json.loads(raw_arguments or "{}"))
    except (ValueError, ValidationError) as exc:
        return False, {"error": "invalid arguments", "detail": str(exc)[:1500]}
    try:
        return True, tool.fn(ctx, args)
    except ToolFailure as exc:
        return False, {"error": str(exc)}
    except ApiException as exc:
        return False, {"error": _api_message(exc), "status": exc.status}
    except Exception as exc:  # noqa: BLE001 - network errors and the like are results the agent should see
        return False, {"error": f"{type(exc).__name__}: {str(exc)[:500]}"}


def _api_message(exc: ApiException) -> str:
    try:
        return f"{exc.status}: {json.loads(exc.body).get('message')}"
    except (TypeError, ValueError):
        return f"{exc.status} {exc.reason}"
