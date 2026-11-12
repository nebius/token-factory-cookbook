"""Kubernetes access.

Two kinds of client:
- the setup client, built from the operator's kubeconfig, used only by the experiment
  harness (setup, inject, reset, hidden verification) and the cluster overview;
- the agent client, which authenticates as the namespace-scoped `kubetrace-agent`
  ServiceAccount with a short-lived token. Everything the agent does goes through it,
  so Kubernetes RBAC limits the agent even if the policy layer had a bug.
"""
from __future__ import annotations

import copy
import json
import tempfile
from dataclasses import dataclass
from pathlib import Path

import urllib3
from kubernetes import client, config
from kubernetes.client import ApiClient, Configuration

# Every Kubernetes request gets a connect and read timeout unless a call sets its own, so a
# network blip cannot hang a run (seen once: a list call waited 71 minutes with no timeout).
DEFAULT_TIMEOUT = urllib3.Timeout(connect=10, read=60)


def _api_client(cfg: Configuration) -> ApiClient:
    api = ApiClient(cfg)
    api.rest_client.pool_manager.connection_pool_kw["timeout"] = DEFAULT_TIMEOUT
    return api

AGENT_SERVICE_ACCOUNT = "kubetrace-agent"


@dataclass
class ClusterHandle:
    api: ApiClient
    context: str
    server: str
    source: str  # "kubeconfig" or "civo"


def _configuration() -> Configuration:
    cfg = Configuration()
    # The generated client rejects valid API responses such as an EndpointSlice with no
    # endpoints ("endpoints must not be None"). The API server validates everything anyway.
    cfg.client_side_validation = False
    return cfg


def load_setup_client(kubeconfig: str = "", context: str = "", kubeconfig_text: str = "", source: str = "kubeconfig") -> ClusterHandle:
    cfg = _configuration()
    if kubeconfig_text:
        # Civo hands back kubeconfig YAML; it is written to a private temp file and removed at once.
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as fh:
            fh.write(kubeconfig_text)
            path = fh.name
        try:
            config.load_kube_config(config_file=path, context=context or None, client_configuration=cfg)
            contexts, active = config.list_kube_config_contexts(config_file=path)
        finally:
            Path(path).unlink(missing_ok=True)
    else:
        config.load_kube_config(config_file=kubeconfig or None, context=context or None, client_configuration=cfg)
        contexts, active = config.list_kube_config_contexts(config_file=kubeconfig or None)
    name = context or (active or {}).get("name", "")
    return ClusterHandle(api=_api_client(cfg), context=name, server=cfg.host, source=source)


def agent_client(setup: ClusterHandle, namespace: str, ttl_seconds: int = 3600) -> ApiClient:
    """A client that acts as the restricted ServiceAccount, using a fresh bound token."""
    core = client.CoreV1Api(setup.api)
    request = client.AuthenticationV1TokenRequest(spec=client.V1TokenRequestSpec(
        audiences=[], expiration_seconds=ttl_seconds))
    token = core.create_namespaced_service_account_token(AGENT_SERVICE_ACCOUNT, namespace, request).status.token
    base = setup.api.configuration
    cfg = _configuration()
    cfg.host = base.host
    cfg.ssl_ca_cert = base.ssl_ca_cert
    cfg.verify_ssl = base.verify_ssl
    cfg.api_key = {"authorization": token}
    cfg.api_key_prefix = {"authorization": "Bearer"}
    return _api_client(cfg)


def list_endpoint_slices(api: ApiClient, namespace: str, label_selector: str = "") -> list[dict]:
    """EndpointSlices as plain JSON. The generated V1EndpointSlice model refuses slices with no
    endpoints (exactly the broken-Service case), so these are never deserialized into models."""
    resp = client.DiscoveryV1Api(api).list_namespaced_endpoint_slice(namespace, label_selector=label_selector,
                                                                      _preload_content=False)
    return json.loads(resp.data).get("items", [])


def read_endpoint_slice(api: ApiClient, namespace: str, name: str) -> dict:
    resp = client.DiscoveryV1Api(api).read_namespaced_endpoint_slice(name, namespace, _preload_content=False)
    return json.loads(resp.data)


def sanitize(obj) -> dict:
    """A plain dict of an API object, without managedFields and last-applied annotations."""
    data = obj if isinstance(obj, dict) else client.ApiClient().sanitize_for_serialization(obj)
    data = copy.deepcopy(data)
    meta = data.get("metadata") or {}
    meta.pop("managedFields", None)
    (meta.get("annotations") or {}).pop("kubectl.kubernetes.io/last-applied-configuration", None)
    return data
