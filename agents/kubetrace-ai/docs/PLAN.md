# KubeTrace AI: implementation plan

Written 2026-10-16, before implementation.

## Verified before building

- **Nebius Token Factory**: `https://api.tokenfactory.nebius.com/v1`, OpenAI-compatible. The live catalog for the project's key lists 27 models, and **no Reflection Beam model**. Beam is reported as waitlist-only (Reflection API beta) with weights due later. Beam stays a configuration value (`NEBIUS_MODEL`); live Beam verification is **pending**.
- **Live runs until then** use `meta-models/muse-spark-open` (Muse Spark Open, Meta), chosen by the project owner, and every report names that model. Probed 2026-10-16:
  - multi-turn tool calling works: tool call → tool result → answer;
  - it rejects `reasoning_effort: none` and `max` (it accepts low, medium, high and xhigh);
  - responses carry a `reasoning_content` field, which KubeTrace never stores or displays.
- **Civo**: the account had no clusters. The project owner approved creating one, `kubetrace-demo` (LON1, 2 × g4s.kube.medium). Cluster creation is never automatic in the app.
- **Local**: kind 0.20, kubectl 1.35, Docker Desktop, Python 3.11/uv, Node 22.

## Architecture

```
apps/web (React, Vite, Tailwind, shadcn-style UI, React Flow)
   │  REST + SSE (Last-Event-ID replay)
services/api (FastAPI)  ── SQLite (migrations) + artifacts/
   ├─ cluster: kubeconfig context or Civo API → kubeconfig (server-side only)
   ├─ experiments: setup / inject / prove-fault / hidden verify / reset   (experiments/)
   └─ runs: starts the agent, persists events, approvals, reports
services/agent
   ├─ loop: bounded tool-calling loop (steps, seconds, tokens, write attempts, cancel)
   ├─ tools: typed (Pydantic) read, code, test and remediation tools
   ├─ policy: validates every mutation; review mode or demo auto-fix mode
   ├─ executor: dry-run → apply with resourceVersion precondition → capture prior state
   ├─ runner: tests in a disposable container (no network, no credentials, no socket)
   ├─ builder: image build adapter (kind load, or push to a registry), immutable tags
   └─ llm: OpenAI-compatible client, or a clearly labelled fixture model
demo/app: storefront checkout service (stdlib Python), tests, Dockerfile, manifests
```

The agent talks to Kubernetes only through a namespace-scoped ServiceAccount token. Civo credentials stay in the API process and never reach the agent, the model or the browser.

## Vertical slice order

1. Demo app and manifests, kind cluster, RBAC.
2. Backend: cluster overview and topology, scenario 1 (selector), agent loop with tools and policy, events, SSE, report.
3. Scenario 2 (code fix: tests, image build, deploy), then 3 (readiness) and 4 (config); 5 (OOM) and 6 (escalation) if capacity allows.
4. Frontend: overview, catalog, investigation workspace, report.
5. Tests: unit (policy, redaction, loop, SSE), kind integration for scenarios 1–3, Playwright UI flow.
6. Live runs: kind and Civo, on Muse Spark Open. Results table from those runs only.
