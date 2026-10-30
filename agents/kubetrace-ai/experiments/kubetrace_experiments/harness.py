"""Privileged experiment harness: baseline, fault injection, hidden verification, reset.

This module runs with the operator's kubeconfig. Nothing here is visible to the agent:
not the injected change, not the checks, not the expected values. The agent works only
from the cluster and the run workspace.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import time
import urllib.parse
from pathlib import Path
from types import ModuleType

import yaml
from kubernetes import client, utils
from kubernetes.client.rest import ApiException

from kubetrace_agent.k8s import ClusterHandle, list_endpoint_slices
from kubetrace_agent.sandbox import BuildError, ImageBuilder
from kubetrace_agent.settings import ROOT, Settings
from kubetrace_agent.workspace import Workspace

RBAC_FILE = ROOT / "deploy" / "rbac" / "agent-role.yaml"
RUNNER_DOCKERFILE = ROOT / "deploy" / "runner"
TEMPLATE = ROOT / "demo" / "app"


def oracle() -> ModuleType:
    """The reference pricing module from the pristine template, loaded independently of any workspace."""
    spec = importlib.util.spec_from_file_location("kubetrace_oracle_pricing", TEMPLATE / "storefront" / "pricing.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HarnessError(Exception):
    pass


class Harness:
    def __init__(self, settings: Settings, cluster: ClusterHandle) -> None:
        self.settings = settings
        self.cluster = cluster
        self.ns = settings.demo_namespace
        self.core = client.CoreV1Api(cluster.api)
        self.apps = client.AppsV1Api(cluster.api)
        self.builder = ImageBuilder(settings)
        self._baseline_image: str | None = None

    # Images ------------------------------------------------------------------------------
    def source_hash(self, path: Path) -> str:
        digest = hashlib.sha256()
        for f in sorted(path.rglob("*")):
            if f.is_file() and "__pycache__" not in f.parts and ".pytest_cache" not in f.parts and ".git" not in f.parts \
                    and f.relative_to(path).parts[0] in ("storefront", "Dockerfile"):
                digest.update(str(f.relative_to(path)).encode())
                digest.update(f.read_bytes())
        return digest.hexdigest()[:12]

    def build(self, source: Path, label: str) -> str:
        tag = f"{label}-{self.source_hash(source)}"
        try:
            return self.builder.build(source, tag).ref
        except BuildError as exc:
            raise HarnessError(str(exc)) from exc

    def baseline_image(self) -> str:
        if self._baseline_image is None:
            self._baseline_image = self.build(TEMPLATE, "baseline")
        return self._baseline_image

    def ensure_runner_image(self) -> None:
        if self.settings.test_runner != "docker":
            return
        have = subprocess.run([self.settings.docker_bin, "image", "inspect", self.settings.runner_image], capture_output=True)
        if have.returncode != 0:
            proc = subprocess.run([self.settings.docker_bin, "build", "-t", self.settings.runner_image, str(RUNNER_DOCKERFILE)],
                                  capture_output=True, text=True, timeout=600)
            if proc.returncode != 0:
                raise HarnessError(f"runner image build failed: {proc.stderr[-2000:]}")

    # Kubernetes ----------------------------------------------------------------------------
    def apply_docs(self, docs: list[dict], namespace: str | None = None) -> None:
        """Create or replace each object (privileged path, used for baseline and injection only)."""
        for doc in docs:
            if not doc:
                continue
            kind, name = doc["kind"], doc["metadata"]["name"]
            ns = namespace if doc["kind"] not in ("Namespace",) else None
            if ns:
                doc.setdefault("metadata", {})["namespace"] = ns
            try:
                utils.create_from_dict(self.cluster.api, doc, namespace=ns)
            except utils.FailToCreateError as exc:
                if not all(getattr(e, "status", None) == 409 for e in exc.api_exceptions):
                    raise HarnessError(f"could not create {kind}/{name}: {exc}") from exc
                self._replace(doc, ns)

    def _replace(self, doc: dict, ns: str | None) -> None:
        kind, name = doc["kind"], doc["metadata"]["name"]
        if kind == "Deployment":
            live = self.apps.read_namespaced_deployment(name, ns)
            doc["metadata"]["resourceVersion"] = live.metadata.resource_version
            self.apps.replace_namespaced_deployment(name, ns, doc)
        elif kind == "Service":
            live = self.core.read_namespaced_service(name, ns)
            doc["metadata"]["resourceVersion"] = live.metadata.resource_version
            doc["spec"]["clusterIP"] = live.spec.cluster_ip
            self.core.replace_namespaced_service(name, ns, doc)
        elif kind == "ConfigMap":
            self.core.replace_namespaced_config_map(name, ns, doc)
        elif kind in ("ServiceAccount", "Role", "RoleBinding", "Namespace"):
            pass  # already present and unchanged by experiments
        else:
            raise HarnessError(f"harness cannot replace {kind}")

    def ensure_namespace(self, name: str, labels: dict[str, str]) -> None:
        try:
            self.core.read_namespace(name)
        except ApiException as exc:
            if exc.status != 404:
                raise
            self.core.create_namespace(client.V1Namespace(metadata=client.V1ObjectMeta(name=name, labels=labels)))
        for _ in range(60):
            if self.core.read_namespace(name).status.phase == "Active":
                return
            time.sleep(1)

    def install_rbac(self) -> None:
        text = RBAC_FILE.read_text().replace("${DEMO_NAMESPACE}", self.ns)
        self.apply_docs(list(yaml.safe_load_all(text)), self.ns)

    def delete_namespace(self, name: str, wait_s: int = 120) -> None:
        try:
            self.core.delete_namespace(name)
        except ApiException as exc:
            if exc.status == 404:
                return
            raise
        deadline = time.monotonic() + wait_s
        while time.monotonic() < deadline:
            try:
                self.core.read_namespace(name)
            except ApiException as exc:
                if exc.status == 404:
                    return
            time.sleep(2)
        raise HarnessError(f"namespace {name} was not deleted within {wait_s} s")

    def deploy_workspace(self, ws: Workspace, files: tuple[str, ...] = ("configmap.yaml", "deployment.yaml", "service.yaml", "probe.yaml")) -> None:
        docs = []
        for f in files:
            docs += [d for d in yaml.safe_load_all(ws.read(f"k8s/{f}")) if d]
        self.apply_docs(docs, self.ns)

    def wait_rollout(self, name: str, timeout_s: int = 180, namespace: str | None = None) -> bool:
        ns = namespace or self.ns
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            d = self.apps.read_namespaced_deployment(name, ns)
            if (d.status.observed_generation or 0) >= d.metadata.generation and d.status.updated_replicas == d.spec.replicas \
                    and d.status.ready_replicas == d.spec.replicas and not d.status.unavailable_replicas:
                return True
            time.sleep(2)
        return False

    def wait_for(self, predicate, timeout_s: int = 120, interval: float = 3) -> bool:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            try:
                if predicate():
                    return True
            except ApiException:
                pass
            time.sleep(interval)
        return False

    def http(self, service: str, path: str, method: str = "GET", body: dict | None = None) -> dict:
        """An HTTP request through a Service, sent from the probe Pod (same path as the agent's check)."""
        query = {"url": f"http://{service}.{self.ns}.svc:80{path}", "method": method}
        if body is not None:
            query["body"] = json.dumps(body)
        resource = f"/api/v1/namespaces/{self.ns}/services/probe:80/proxy/probe?{urllib.parse.urlencode(query)}"
        try:
            resp = self.cluster.api.call_api(resource, "GET", auth_settings=["BearerToken"], response_type="str",
                                             _preload_content=False, _request_timeout=15)[0]
            data = json.loads(resp.data)
        except (ApiException, ValueError) as exc:
            return {"ok": False, "error": f"probe unreachable: {exc}"}
        if isinstance(data.get("body"), str):
            try:
                data["body"] = json.loads(data["body"])
            except ValueError:
                pass
        return data

    def deployment(self, name: str = "storefront") -> dict:
        return client.ApiClient().sanitize_for_serialization(self.apps.read_namespaced_deployment(name, self.ns))

    def pods(self, selector: str = "app.kubernetes.io/name=storefront") -> list:
        return self.core.list_namespaced_pod(self.ns, label_selector=selector).items

    def ready_endpoints(self, service: str = "storefront") -> int:
        slices = list_endpoint_slices(self.cluster.api, self.ns, f"kubernetes.io/service-name={service}")
        return sum(1 for s in slices for ep in s.get("endpoints") or [] if (ep.get("conditions") or {}).get("ready"))

    def node_capacity(self) -> dict:
        nodes = self.core.list_node().items
        return {"nodes": len(nodes),
                "kubelet_version": nodes[0].status.node_info.kubelet_version if nodes else None,
                "allocatable": [{"name": n.metadata.name, "cpu": n.status.allocatable.get("cpu"),
                                 "memory": n.status.allocatable.get("memory")} for n in nodes]}
