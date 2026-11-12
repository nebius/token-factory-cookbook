"""Mutation policy.

The agent proposes; this module decides. It compares the live object with the object the
API server would store (a server-side dry run of the proposal, so defaults are filled in)
and allows only listed paths with checked values. Anything not explicitly allowed is
denied. Kubernetes RBAC on the agent's ServiceAccount enforces the same scope again.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

EXPERIMENT_LABEL = "kubetrace.ai/experiment"
ALLOWED_KINDS = {"Deployment", "Service", "ConfigMap"}
MAX_MEMORY_LIMIT_MI = 512
MAX_CPU_LIMIT_M = 1000
MAX_REPLICAS = 4
# Settings that are business controls, not configuration the agent may tune. Added after a live run
# (Muse Spark Open, Civo, partner-outage) "fixed" a payment-gateway outage by disabling payment
# authorization. The agent may not clear or redirect these; an outage behind them is an escalation.
PROTECTED_CONFIG_KEYS = {"payment_gateway_url"}

IGNORED = [
    r"^metadata\.(resourceVersion|generation|uid|creationTimestamp|managedFields)",
    r"^metadata\.annotations\.deployment\.kubernetes\.io/revision$",
    r"^status(\.|$)",
]

ALLOWED: dict[str, list[str]] = {
    "Deployment": [
        r"^spec\.replicas$",
        r"^spec\.template\.metadata\.annotations\.kubectl\.kubernetes\.io/restartedAt$",
        r"^spec\.template\.metadata\.annotations\.kubetrace\.ai/[a-z-]+$",
        r"^spec\.template\.metadata\.labels\.[A-Za-z0-9./_-]+$",
        r"^spec\.template\.spec\.containers\[name=storefront\]\.image$",
        r"^spec\.template\.spec\.containers\[name=storefront\]\.env(\[.*)?",
        r"^spec\.template\.spec\.containers\[name=storefront\]\.(readinessProbe|livenessProbe|startupProbe)(\..*)?$",
        r"^spec\.template\.spec\.containers\[name=storefront\]\.resources(\..*)?$",
        r"^metadata\.annotations\.[A-Za-z0-9./_-]+$",
        r"^metadata\.labels\.[A-Za-z0-9./_-]+$",
    ],
    "Service": [
        r"^spec\.selector(\.[A-Za-z0-9./_-]+)?$",
        r"^spec\.ports\[(name=)?[A-Za-z0-9-]+\]\.(port|targetPort)$",
        r"^metadata\.annotations\.[A-Za-z0-9./_-]+$",
        r"^metadata\.labels\.[A-Za-z0-9./_-]+$",
    ],
    "ConfigMap": [
        r"^data\.config\.json$",
        r"^metadata\.annotations\.[A-Za-z0-9./_-]+$",
        r"^metadata\.labels\.[A-Za-z0-9./_-]+$",
    ],
}


@dataclass
class Decision:
    allowed: bool
    reasons: list[str] = field(default_factory=list)
    changed_paths: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"allowed": self.allowed, "reasons": self.reasons, "changed_paths": self.changed_paths}


def _key(item: Any, index: int) -> str:
    if isinstance(item, dict) and isinstance(item.get("name"), str):
        return f"name={item['name']}"
    return str(index)


def diff_paths(before: Any, after: Any, prefix: str = "") -> list[str]:
    """Dotted paths whose values differ. Lists of named items are keyed by name."""
    if isinstance(before, dict) and isinstance(after, dict):
        out: list[str] = []
        for key in sorted(set(before) | set(after)):
            path = f"{prefix}.{key}" if prefix else key
            if key not in before or key not in after:
                present = after.get(key, before.get(key))
                # A whole map added or removed: report its leaves, so per-key rules apply.
                if isinstance(present, dict) and present:
                    out += diff_paths(before.get(key, {}), after.get(key, {}), path)
                else:
                    out.append(path)
            else:
                out += diff_paths(before[key], after[key], path)
        return out
    if isinstance(before, list) and isinstance(after, list):
        b = {_key(v, i): v for i, v in enumerate(before)}
        a = {_key(v, i): v for i, v in enumerate(after)}
        out = []
        for key in list(dict.fromkeys(list(b) + list(a))):
            path = f"{prefix}[{key}]"
            if key not in b or key not in a:
                out.append(path)
            else:
                out += diff_paths(b[key], a[key], path)
        return out
    return [] if before == after else [prefix]


def _quantity_mi(value: Any) -> float | None:
    if value is None:
        return None
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(Ki|Mi|Gi|K|M|G)?", str(value))
    if not match:
        return None
    number, unit = float(match.group(1)), match.group(2) or ""
    return number * {"": 1 / 1048576, "Ki": 1 / 1024, "Mi": 1, "Gi": 1024, "K": 1000 / 1048576,
                     "M": 1e6 / 1048576, "G": 1e9 / 1048576}[unit]


def _cpu_m(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value)
    if text.endswith("m"):
        return float(text[:-1])
    try:
        return float(text) * 1000
    except ValueError:
        return None


def _container(obj: dict, name: str = "storefront") -> dict | None:
    for c in obj.get("spec", {}).get("template", {}).get("spec", {}).get("containers", []) or []:
        if c.get("name") == name:
            return c
    return None


def evaluate(kind: str, live: dict, proposed: dict, *, namespace: str, allowed_images: set[str]) -> Decision:
    reasons: list[str] = []
    if kind not in ALLOWED_KINDS:
        return Decision(False, [f"{kind} is not a kind the agent may change"])
    meta, new_meta = live.get("metadata", {}), proposed.get("metadata", {})
    if meta.get("namespace") != namespace or new_meta.get("namespace") != namespace:
        return Decision(False, [f"only resources in namespace {namespace} may change"])
    if (meta.get("labels") or {}).get(EXPERIMENT_LABEL) != "true":
        return Decision(False, [f"{kind}/{meta.get('name')} is not labelled {EXPERIMENT_LABEL}=true"])
    if (new_meta.get("labels") or {}).get(EXPERIMENT_LABEL) != "true":
        reasons.append(f"the {EXPERIMENT_LABEL} label must stay")

    changed = [p for p in diff_paths(live, proposed) if not any(re.search(i, p) for i in IGNORED)]
    if not changed:
        return Decision(False, ["the proposal changes nothing"], [])
    for path in changed:
        if not any(re.search(rule, path) for rule in ALLOWED[kind]):
            reasons.append(f"changing {path} is not allowed")

    if kind == "Deployment":
        reasons += _check_deployment(live, proposed, allowed_images)
    elif kind == "Service":
        spec = proposed.get("spec", {})
        if spec.get("type", "ClusterIP") != "ClusterIP" or spec.get("externalIPs"):
            reasons.append("the Service must stay ClusterIP with no external IPs")
        if not spec.get("selector"):
            reasons.append("a Service selector cannot be removed")
    elif kind == "ConfigMap":
        if len((proposed.get("data") or {}).get("config.json", "")) > 16_000:
            reasons.append("config.json is larger than 16 KB")
        reasons += _check_protected_config(live, proposed)
    return Decision(not reasons, reasons, changed)


def _check_protected_config(live: dict, proposed: dict) -> list[str]:
    import json
    def parse(obj: dict) -> dict:
        try:
            value = json.loads((obj.get("data") or {}).get("config.json", "{}"))
            return value if isinstance(value, dict) else {}
        except ValueError:
            return {}
    before, after = parse(live), parse(proposed)
    return [f"{key} is a protected business control; the agent may not clear or redirect it (escalate instead)"
            for key in PROTECTED_CONFIG_KEYS if key in before and before.get(key) != after.get(key)]


def _check_deployment(live: dict, proposed: dict, allowed_images: set[str]) -> list[str]:
    reasons = []
    replicas = proposed.get("spec", {}).get("replicas", 1)
    if not 1 <= replicas <= MAX_REPLICAS:
        reasons.append(f"replicas must be 1..{MAX_REPLICAS}")
    before, after = _container(live), _container(proposed)
    if after is None:
        return reasons + ["the storefront container cannot be removed"]
    if before and after.get("image") != before.get("image") and after.get("image") not in allowed_images:
        reasons.append(f"image {after.get('image')} was not built by this run; only images from build_image may be deployed")
    ports = {p.get("name") for p in after.get("ports") or []} | {p.get("containerPort") for p in after.get("ports") or []}
    for probe_name in ("readinessProbe", "livenessProbe"):
        probe = after.get(probe_name)
        if before and before.get(probe_name) and not probe:
            reasons.append(f"{probe_name} cannot be removed; fix it instead")
            continue
        if not probe:
            continue
        if "exec" in probe:
            reasons.append(f"{probe_name} may not use an exec command; use httpGet or tcpSocket")
        handler = probe.get("httpGet") or probe.get("tcpSocket")
        if handler is None:
            reasons.append(f"{probe_name} must use httpGet or tcpSocket")
        elif handler.get("port") not in ports:
            reasons.append(f"{probe_name} port {handler.get('port')!r} is not a container port")
    limits = (after.get("resources") or {}).get("limits") or {}
    requests = (after.get("resources") or {}).get("requests") or {}
    mem, cpu = _quantity_mi(limits.get("memory")), _cpu_m(limits.get("cpu"))
    if mem is None or mem > MAX_MEMORY_LIMIT_MI:
        reasons.append(f"memory limit must be set and at most {MAX_MEMORY_LIMIT_MI}Mi")
    if cpu is not None and cpu > MAX_CPU_LIMIT_M:
        reasons.append(f"cpu limit may be at most {MAX_CPU_LIMIT_M}m")
    req_mem = _quantity_mi(requests.get("memory"))
    if mem is not None and req_mem is not None and req_mem > mem:
        reasons.append("memory request exceeds the limit")
    return reasons
