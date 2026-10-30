"""Cluster connection, overview and topology.

The connection lives server-side. A kubeconfig fetched from Civo is kept in memory only
and is never returned to the browser, written to the database, or shown to the model.
"""
from __future__ import annotations

import threading
import time
from typing import Any

import httpx
from kubernetes import client
from kubernetes.client.rest import ApiException

from kubetrace_agent.k8s import ClusterHandle, list_endpoint_slices, load_setup_client, sanitize
from kubetrace_agent.settings import Settings


class ConnectionError_(Exception):
    pass


class CivoClient:
    """Lists clusters and fetches a kubeconfig. Verified against the live API on 2026-10-16."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _headers(self) -> dict:
        if not self.settings.civo_api_key:
            raise ConnectionError_("CIVO_API_KEY is not set on the server")
        return {"Authorization": f"bearer {self.settings.civo_api_key}"}

    def list_clusters(self, region: str | None = None) -> list[dict]:
        region = region or self.settings.civo_region
        out, page = [], 1
        while True:
            r = httpx.get(f"{self.settings.civo_api_url}/kubernetes/clusters", params={"region": region, "page": page},
                          headers=self._headers(), timeout=30)
            if r.status_code == 401:
                raise ConnectionError_("Civo rejected CIVO_API_KEY (401)")
            r.raise_for_status()
            data = r.json()
            for c in data.get("items", []):
                out.append({"id": c["id"], "name": c["name"], "status": c.get("status"),
                            "kubernetes_version": c.get("kubernetes_version"), "nodes": c.get("num_target_nodes"),
                            "size": c.get("target_nodes_size"), "region": region})
            if page >= data.get("pages", 1):
                return out
            page += 1

    def kubeconfig(self, cluster_id: str, region: str | None = None) -> str:
        r = httpx.get(f"{self.settings.civo_api_url}/kubernetes/clusters/{cluster_id}",
                      params={"region": region or self.settings.civo_region}, headers=self._headers(), timeout=30)
        if r.status_code == 404:
            raise ConnectionError_(f"Civo cluster {cluster_id} not found in region {region or self.settings.civo_region}")
        r.raise_for_status()
        text = r.json().get("kubeconfig")
        if not text:
            raise ConnectionError_("the cluster has no kubeconfig yet (still provisioning?)")
        return text


class ClusterManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.handle: ClusterHandle | None = None
        self.civo_cluster: dict | None = None
        self.error: str | None = None
        self.lock = threading.Lock()

    def connect_kubeconfig(self, context: str = "") -> dict:
        with self.lock:
            try:
                self.handle = load_setup_client(self.settings.kubeconfig, context or self.settings.kube_context)
                self.civo_cluster, self.error = None, None
            except Exception as exc:  # noqa: BLE001
                self.handle, self.error = None, f"kubeconfig: {exc}"
                raise ConnectionError_(self.error) from exc
        return self.status()

    def connect_civo(self, cluster_id: str, region: str | None = None) -> dict:
        civo = CivoClient(self.settings)
        text = civo.kubeconfig(cluster_id, region)
        with self.lock:
            self.handle = load_setup_client(kubeconfig_text=text, source="civo")
            self.civo_cluster = next((c for c in civo.list_clusters(region) if c["id"] == cluster_id), {"id": cluster_id})
            self.settings.cluster_kind = "civo"
            self.error = None
        return self.status()

    def require(self) -> ClusterHandle:
        if self.handle is None:
            raise ConnectionError_(self.error or "not connected to a cluster")
        return self.handle

    def status(self) -> dict:
        if self.handle is None:
            return {"connected": False, "error": self.error}
        info: dict[str, Any] = {"connected": True, "source": self.handle.source, "context": self.handle.context,
                                "server": self.handle.server, "cluster_kind": self.settings.cluster_kind,
                                "civo_cluster": self.civo_cluster, "demo_namespace": self.settings.demo_namespace}
        try:
            version = client.VersionApi(self.handle.api).get_code()
            info["kubernetes_version"] = version.git_version
        except Exception as exc:  # noqa: BLE001
            info["error"] = f"API server unreachable: {exc}"
        return info

    # Overview -----------------------------------------------------------------------------------
    def overview(self, namespace: str | None) -> dict:
        h = self.require()
        core, apps = client.CoreV1Api(h.api), client.AppsV1Api(h.api)
        fetched = time.time()
        nodes = []
        for n in core.list_node().items:
            ready = next((c.status == "True" for c in n.status.conditions or [] if c.type == "Ready"), False)
            nodes.append({"name": n.metadata.name, "ready": ready, "version": n.status.node_info.kubelet_version,
                          "cpu": n.status.allocatable.get("cpu"), "memory": n.status.allocatable.get("memory")})
        namespaces = [ns.metadata.name for ns in core.list_namespace().items]
        ns = namespace or self.settings.demo_namespace
        result = {"fetched_at": fetched, "nodes": nodes, "namespaces": namespaces, "namespace": ns,
                  "deployments": [], "pods": [], "services": []}
        if ns not in namespaces:
            result["warning"] = f"namespace {ns} does not exist yet (set up an experiment to create it)"
            return result
        for d in apps.list_namespaced_deployment(ns).items:
            want, ready = d.spec.replicas or 0, d.status.ready_replicas or 0
            result["deployments"].append({"name": d.metadata.name, "replicas": want, "ready": ready,
                                          "updated": d.status.updated_replicas or 0,
                                          "health": "ok" if ready == want and want else ("error" if ready == 0 else "warn"),
                                          "images": [c.image for c in d.spec.template.spec.containers]})
        for p in core.list_namespaced_pod(ns).items:
            result["pods"].append(_pod_row(p))
        slices = list_endpoint_slices(h.api, ns)
        for s in core.list_namespaced_service(ns).items:
            eps = [ep for sl in slices if (sl["metadata"].get("labels") or {}).get("kubernetes.io/service-name") == s.metadata.name
                   for ep in sl.get("endpoints") or []]
            ready_eps = sum(1 for ep in eps if (ep.get("conditions") or {}).get("ready"))
            result["services"].append({"name": s.metadata.name, "type": s.spec.type, "selector": s.spec.selector or {},
                                       "ports": [p.port for p in s.spec.ports or []], "ready_endpoints": ready_eps,
                                       "health": "ok" if ready_eps else "error"})
        return result

    def topology(self, namespace: str | None) -> dict:
        h = self.require()
        ns = namespace or self.settings.demo_namespace
        core, apps = client.CoreV1Api(h.api), client.AppsV1Api(h.api)
        nodes, edges = [], []
        try:
            pods = core.list_namespaced_pod(ns).items
            rss = apps.list_namespaced_replica_set(ns).items
            deps = apps.list_namespaced_deployment(ns).items
            svcs = core.list_namespaced_service(ns).items
            slices = list_endpoint_slices(h.api, ns)
        except ApiException as exc:
            return {"namespace": ns, "nodes": [], "edges": [], "error": f"{exc.status} {exc.reason}", "fetched_at": time.time()}
        active_rs = {r.metadata.name for r in rss if (r.status.replicas or 0) > 0}
        for d in deps:
            want, ready = d.spec.replicas or 0, d.status.ready_replicas or 0
            nodes.append({"id": f"Deployment/{d.metadata.name}", "kind": "Deployment", "name": d.metadata.name,
                          "health": "ok" if ready == want and want else ("error" if ready == 0 else "warn"),
                          "detail": f"{ready}/{want} ready"})
        for r in rss:
            if r.metadata.name not in active_rs:
                continue
            nodes.append({"id": f"ReplicaSet/{r.metadata.name}", "kind": "ReplicaSet", "name": r.metadata.name,
                          "health": "ok" if (r.status.ready_replicas or 0) == (r.spec.replicas or 0) else "warn",
                          "detail": f"{r.status.ready_replicas or 0}/{r.spec.replicas} ready"})
            for o in r.metadata.owner_references or []:
                edges.append({"source": f"{o.kind}/{o.name}", "target": f"ReplicaSet/{r.metadata.name}", "kind": "owns",
                              "observed": True})
        for p in pods:
            row = _pod_row(p)
            nodes.append({"id": f"Pod/{p.metadata.name}", "kind": "Pod", "name": p.metadata.name, "health": row["health"],
                          "detail": row["status"]})
            for o in p.metadata.owner_references or []:
                edges.append({"source": f"{o.kind}/{o.name}", "target": f"Pod/{p.metadata.name}", "kind": "owns", "observed": True})
        for s in svcs:
            endpoint_pods = {ep["targetRef"]["name"] for sl in slices
                             if (sl["metadata"].get("labels") or {}).get("kubernetes.io/service-name") == s.metadata.name
                             for ep in sl.get("endpoints") or [] if ep.get("targetRef")}
            selector = s.spec.selector or {}
            selected = {p.metadata.name for p in pods if selector and all((p.metadata.labels or {}).get(k) == v
                                                                        for k, v in selector.items())}
            nodes.append({"id": f"Service/{s.metadata.name}", "kind": "Service", "name": s.metadata.name,
                          "health": "ok" if endpoint_pods else "error",
                          "detail": f"{len(endpoint_pods)} endpoints · selector {', '.join(f'{k}={v}' for k, v in selector.items())}"})
            for name in endpoint_pods:
                # Reported by the API in an EndpointSlice.
                edges.append({"source": f"Service/{s.metadata.name}", "target": f"Pod/{name}", "kind": "endpoint", "observed": True})
            for name in selected - endpoint_pods:
                # Inferred by evaluating the selector; the Pod is not (yet) an endpoint.
                edges.append({"source": f"Service/{s.metadata.name}", "target": f"Pod/{name}", "kind": "selects",
                              "observed": False})
        return {"namespace": ns, "nodes": nodes, "edges": edges, "fetched_at": time.time()}

    def resource(self, kind: str, namespace: str, name: str) -> dict:
        h = self.require()
        core, apps = client.CoreV1Api(h.api), client.AppsV1Api(h.api)
        readers = {"Pod": core.read_namespaced_pod, "Service": core.read_namespaced_service,
                   "Deployment": apps.read_namespaced_deployment, "ReplicaSet": apps.read_namespaced_replica_set,
                   "ConfigMap": core.read_namespaced_config_map}
        if kind not in readers:
            raise ConnectionError_(f"unsupported kind {kind}")
        obj = sanitize(readers[kind](name, namespace))
        events = [{"type": e.type, "reason": e.reason, "message": e.message, "count": e.count,
                   "last_seen": (e.last_timestamp or e.event_time or e.metadata.creation_timestamp)}
                  for e in core.list_namespaced_event(namespace, field_selector=f"involvedObject.name={name}").items]
        out: dict[str, Any] = {"kind": kind, "name": name, "namespace": namespace, "object": obj,
                               "events": sorted(events, key=lambda e: str(e["last_seen"]), reverse=True)[:30],
                               "conditions": (obj.get("status") or {}).get("conditions") or [],
                               "relationships": [{"kind": o["kind"], "name": o["name"], "relation": "owned by", "observed": True}
                                                 for o in (obj.get("metadata") or {}).get("ownerReferences") or []]}
        if kind == "Pod":
            try:
                out["logs"] = core.read_namespaced_pod_log(name, namespace, tail_lines=150, limit_bytes=40_000)
            except ApiException as exc:
                out["logs"] = f"(logs unavailable: {exc.status} {exc.reason})"
        if kind == "ConfigMap":
            out["object"]["data"] = obj.get("data")
        return out


def _pod_row(p) -> dict:
    statuses = p.status.container_statuses or []
    restarts = sum(cs.restart_count for cs in statuses)
    ready = any(c.type == "Ready" and c.status == "True" for c in p.status.conditions or [])
    waiting = next((cs.state.waiting.reason for cs in statuses if cs.state and cs.state.waiting), None)
    last = next((cs.last_state.terminated.reason for cs in statuses if cs.last_state and cs.last_state.terminated), None)
    status = waiting or ("Running" if p.status.phase == "Running" else p.status.phase)
    if p.metadata.deletion_timestamp:
        status = "Terminating"
    health = "ok" if ready else ("error" if waiting in ("CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "Error")
                                 or last == "OOMKilled" else "warn")
    return {"name": p.metadata.name, "phase": p.status.phase, "status": status, "ready": ready, "restarts": restarts,
            "last_termination": last, "node": p.spec.node_name, "labels": p.metadata.labels or {}, "health": health,
            "owner": p.metadata.owner_references[0].name if p.metadata.owner_references else None}
