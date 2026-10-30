"""Deterministic executor for agent-proposed changes.

Flow for every mutation:
  build the proposed object → server-side dry run (as the agent ServiceAccount) →
  policy check on the dry-run result → approval (review mode) → write with a
  resourceVersion precondition → record the prior state for revert.
"""
from __future__ import annotations

import copy
import difflib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

import yaml
from kubernetes import client
from kubernetes.client import ApiClient
from kubernetes.client.rest import ApiException

from . import policy
from .k8s import sanitize

KIND_API = {
    "Deployment": ("AppsV1Api", "read_namespaced_deployment", "replace_namespaced_deployment"),
    "Service": ("CoreV1Api", "read_namespaced_service", "replace_namespaced_service"),
    "ConfigMap": ("CoreV1Api", "read_namespaced_config_map", "replace_namespaced_config_map"),
}
# Maps replaced whole when a manifest is applied, so a wrong key does not survive a merge.
REPLACE_WHOLE = {
    "Service": [("spec", "selector")],
    "ConfigMap": [("data",)],
    "Deployment": [("spec", "template", "metadata", "labels")],
}


class ExecutionError(Exception):
    pass


@dataclass
class Mutation:
    id: str
    kind: str
    name: str
    source: str            # "patch_resource", "apply_manifest", "deploy_image", "restart_rollout", "revert"
    reason: str
    diff: str = ""
    decision: dict = field(default_factory=dict)
    status: str = "proposed"  # proposed → denied | pending_approval → rejected | applied | failed | stale
    prior: dict | None = None
    applied: dict | None = None
    error: str = ""
    duration_s: float = 0.0

    def public(self) -> dict:
        return {"id": self.id, "kind": self.kind, "name": self.name, "source": self.source, "reason": self.reason,
                "diff": self.diff, "decision": self.decision, "status": self.status, "error": self.error,
                "duration_s": round(self.duration_s, 3)}


def json_merge(target: Any, patch: Any) -> Any:
    """RFC 7386 JSON merge patch."""
    if not isinstance(patch, dict):
        return copy.deepcopy(patch)
    result = copy.deepcopy(target) if isinstance(target, dict) else {}
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = json_merge(result.get(key), value)
    return result


def named_merge(target: Any, patch: Any) -> Any:
    """Merge patch where lists of named items (containers, env, ports, volumes) merge by name, like
    kubectl's strategic merge. A patch item {"name": X, "$patch": "delete"} removes X; null deletes keys."""
    if isinstance(patch, list) and isinstance(target, list) and patch and all(
            isinstance(p, dict) and "name" in p for p in patch) and all(isinstance(t, dict) and "name" in t for t in target):
        out = [copy.deepcopy(t) for t in target]
        for item in patch:
            idx = next((i for i, t in enumerate(out) if t["name"] == item["name"]), None)
            if item.get("$patch") == "delete":
                if idx is not None:
                    out.pop(idx)
            elif idx is None:
                out.append({k: v for k, v in item.items() if k != "$patch"})
            else:
                out[idx] = named_merge(out[idx], item)
        return out
    if not isinstance(patch, dict):
        return copy.deepcopy(patch)
    result = copy.deepcopy(target) if isinstance(target, dict) else {}
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = named_merge(result.get(key), value)
    return result


def _strip_runtime(obj: dict) -> dict:
    obj = copy.deepcopy(obj)
    obj.pop("status", None)
    meta = obj.get("metadata", {})
    for key in ("managedFields", "uid", "creationTimestamp", "generation"):
        meta.pop(key, None)
    return obj


def yaml_diff(before: dict, after: dict, label: str) -> str:
    def dump(o: dict) -> list[str]:
        o = _strip_runtime(o)
        o.get("metadata", {}).pop("resourceVersion", None)
        return yaml.safe_dump(o, sort_keys=True, default_flow_style=False).splitlines(keepends=True)
    return "".join(difflib.unified_diff(dump(before), dump(after), f"live/{label}", f"proposed/{label}"))


class Executor:
    def __init__(self, api: ApiClient, namespace: str, mode: str,
                 approver: Callable[[Mutation], tuple[bool, str]] | None = None) -> None:
        self.api = api
        self.namespace = namespace
        self.mode = mode
        self.approver = approver
        self.allowed_images: set[str] = set()
        self.history: list[Mutation] = []

    # API helpers ---------------------------------------------------------------------------
    def _api(self, kind: str):
        api_name, read, replace = KIND_API[kind]
        api = getattr(client, api_name)(self.api)
        return getattr(api, read), getattr(api, replace)

    def read(self, kind: str, name: str) -> dict:
        if kind not in KIND_API:
            raise ExecutionError(f"{kind} cannot be changed by the agent")
        reader, _ = self._api(kind)
        return sanitize(reader(name, self.namespace))

    def _replace(self, kind: str, name: str, body: dict, dry_run: bool) -> dict:
        _, replace = self._api(kind)
        kwargs = {"dry_run": "All"} if dry_run else {}
        return sanitize(replace(name, self.namespace, body, field_manager="kubetrace-agent", **kwargs))

    # Building proposals --------------------------------------------------------------------
    def from_merge_patch(self, kind: str, name: str, patch: dict) -> tuple[dict, dict]:
        live = self.read(kind, name)
        proposed = named_merge(_strip_runtime(live), patch)
        proposed["metadata"]["resourceVersion"] = live["metadata"]["resourceVersion"]
        return live, proposed

    def from_manifest(self, manifest: dict) -> tuple[str, str, dict, dict]:
        kind, name = manifest.get("kind"), (manifest.get("metadata") or {}).get("name")
        if kind not in KIND_API or not name:
            raise ExecutionError(f"manifest kind {kind!r} is not one the agent may apply")
        ns = (manifest.get("metadata") or {}).get("namespace")
        if ns and ns != self.namespace:
            raise ExecutionError(f"manifest targets namespace {ns}; only {self.namespace} is allowed")
        live = self.read(kind, name)
        patch = {k: v for k, v in manifest.items() if k not in ("apiVersion", "kind", "status")}
        patch["metadata"] = {k: v for k, v in (manifest.get("metadata") or {}).items() if k in ("labels", "annotations")}
        proposed = json_merge(_strip_runtime(live), patch)
        for path in REPLACE_WHOLE.get(kind, []):
            src, dst = manifest, proposed
            for part in path[:-1]:
                src, dst = (src or {}).get(part), dst.setdefault(part, {})
            if isinstance(src, dict) and path[-1] in src:
                dst[path[-1]] = copy.deepcopy(src[path[-1]])
        proposed["metadata"]["resourceVersion"] = live["metadata"]["resourceVersion"]
        return kind, name, live, proposed

    # Executing -----------------------------------------------------------------------------
    def execute(self, kind: str, name: str, live: dict, proposed: dict, source: str, reason: str,
                on_update: Callable[[Mutation], None] = lambda m: None) -> Mutation:
        started = time.monotonic()
        mutation = Mutation(id=uuid.uuid4().hex[:10], kind=kind, name=name, source=source, reason=reason)
        self.history.append(mutation)
        try:
            dry = self._replace(kind, name, proposed, dry_run=True)
        except ApiException as exc:
            mutation.status, mutation.error = ("stale" if exc.status == 409 else "denied"), _api_error(exc)
            mutation.decision = {"allowed": False, "reasons": [f"server-side dry run rejected it: {mutation.error}"]}
            mutation.duration_s = time.monotonic() - started
            on_update(mutation)
            return mutation
        mutation.diff = yaml_diff(live, dry, f"{kind.lower()}/{name}")
        decision = policy.evaluate(kind, live, dry, namespace=self.namespace, allowed_images=self.allowed_images)
        mutation.decision = decision.as_dict()
        if not decision.allowed:
            mutation.status = "denied"
            mutation.duration_s = time.monotonic() - started
            on_update(mutation)
            return mutation
        if self.mode == "review":
            mutation.status = "pending_approval"
            on_update(mutation)
            approved, note = self.approver(mutation) if self.approver else (False, "no approver configured")
            if not approved:
                mutation.status, mutation.error = "rejected", note or "rejected in review"
                mutation.duration_s = time.monotonic() - started
                on_update(mutation)
                return mutation
        try:
            # The precondition is the resourceVersion seen when the proposal was built.
            applied = self._replace(kind, name, proposed, dry_run=False)
        except ApiException as exc:
            mutation.status = "stale" if exc.status == 409 else "failed"
            mutation.error = _api_error(exc)
            mutation.duration_s = time.monotonic() - started
            on_update(mutation)
            return mutation
        mutation.prior, mutation.applied, mutation.status = live, applied, "applied"
        mutation.duration_s = time.monotonic() - started
        on_update(mutation)
        return mutation

    def revert(self, mutation_id: str, on_update: Callable[[Mutation], None] = lambda m: None) -> Mutation:
        original = next((m for m in self.history if m.id == mutation_id), None)
        if original is None or original.status != "applied" or not original.prior:
            raise ExecutionError(f"no applied change {mutation_id} to revert")
        live = self.read(original.kind, original.name)
        if live["metadata"]["resourceVersion"] != original.applied["metadata"]["resourceVersion"]:
            raise ExecutionError("the resource changed after this change was applied; the captured prior state no "
                                 "longer applies, so it was not reverted")
        proposed = _strip_runtime(original.prior)
        proposed["metadata"]["resourceVersion"] = live["metadata"]["resourceVersion"]
        return self.execute(original.kind, original.name, live, proposed, "revert", f"revert {mutation_id}", on_update)


def _api_error(exc: ApiException) -> str:
    try:
        return json.loads(exc.body).get("message", str(exc.reason))
    except (TypeError, ValueError):
        return f"{exc.status} {exc.reason}"
