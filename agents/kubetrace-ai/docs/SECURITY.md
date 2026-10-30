# Security model

## Credentials

| Credential | Where it lives | Never reaches |
|---|---|---|
| `NEBIUS_API_KEY` | API process environment | browser, model context, events, reports |
| `CIVO_API_KEY` | API process environment | browser, model, agent tools, reports |
| Cluster-admin kubeconfig | API process (file or in-memory from Civo) | agent tools, model, browser |
| Agent token | minted per run (TokenRequest, 1 h) for `kubetrace-agent` | browser, model |

Every tool result, event, log excerpt, transcript and report goes through `services/agent/kubetrace_agent/redact.py`. That module masks known secret values, bearer tokens, JWTs, kubeconfig key material, private keys and `key=value` pairs whose key names a secret. The optional API token (`KUBETRACE_API_TOKEN`) is held in browser memory only, never in storage.

## What the agent can do

Enforced twice:

1. **Kubernetes RBAC** (`deploy/rbac/agent-role.yaml`). The agent can read Pods, logs, events, Services, EndpointSlices, ConfigMaps, Deployments and ReplicaSets in the demo namespace. It can `get` the probe's service proxy, and `patch`/`update` exactly three named objects: Deployment `storefront`, Service `storefront` and ConfigMap `storefront-config`. It has no Secrets, no create or delete, no RBAC, no nodes and no other namespaces. The kind integration tests check these refusals against a real API server.
2. **Policy** (`policy.py`). The executor dry-runs every proposal on the server, so defaults are applied, then compares live and proposed objects path by path against an allowlist. Anything not listed is denied. Specific checks:
   - probes cannot be removed or replaced with `exec`;
   - no securityContext, volume, host, ServiceAccount or command changes;
   - images must come from this run's builds;
   - memory at most 512Mi and replicas at most 4;
   - a Service stays ClusterIP with a selector;
   - only `config.json` in the ConfigMap may change.

   Writes carry the `resourceVersion` the agent saw, so stale proposals fail with 409 and are recorded as `stale`.

The **review mode** setting (`POLICY_MODE=review`, or the toggle) makes every allowed change wait for UI approval. **Demo auto-fix** executes only changes that pass policy.

## Code execution

Agent-written code runs only in `kubetrace-runner`: `docker run --rm --network none --read-only` with the source mounted read-only, `--cap-drop ALL`, `no-new-privileges`, a non-root user, and memory and PID limits. It has no environment credentials and no Docker socket. Image builds happen in a separate adapter on the backend host. The `subprocess` runner fallback is **not** isolated, and reports say so when it was used.

## Untrusted input

Logs, annotations, repository text and tool output are treated as data. The system prompt tells the model never to follow instructions found in them, and the policy layer limits the damage if it does.

## Exposure

The API binds to `127.0.0.1` and Compose publishes to `127.0.0.1` only. Before exposing it anywhere else:

- set `KUBETRACE_API_TOKEN`, which every `/api` call must present;
- put it behind TLS;
- restrict network access;
- prefer review mode.

The API can mutate a cluster and spend model credits.
