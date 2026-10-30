# Testing

## Unit (no cluster, no model): `uv run pytest tests/unit`

- **Policy:** allowed fixes and denials (probe removal, exec probes, privilege, host access, foreign images, memory caps, Service exposure, other namespaces, unlabelled resources, no-ops).
- **Redaction:** known values, bearer tokens, JWTs, kubeconfig data, private keys, and secret-named keys.
- **Agent loop:**
  - unknown tools and bad arguments come back as visible errors;
  - one retry after a failed verification, recorded as first-attempt failure and eventual success;
  - escalation states;
  - step, token and time limits, and cancellation;
  - a model outage blocks the run instead of switching models;
  - a hanging tool is abandoned;
  - exceptions become tool errors;
  - tool output is redacted before the model sees it.
- **Workspace:** writable allowlist, path escapes, `.git` hidden, exact-once edits, diffs including new files.
- **Executor:** merge-patch semantics, whole-selector replacement, the `resourceVersion` precondition, other-namespace refusal.
- **Superficial fixes:** a swallowed exception fails the hidden pricing tests and is detected in the diff; the real fix passes.
- **API:** SSE resumes after `Last-Event-ID`, export and import keep provenance and model, and results keep provenances apart and skip replays.

## Integration on kind: `KUBETRACE_KIND=1 uv run pytest tests/integration`

Needs kind, Docker and `KUBECONFIG` pointing at the kind cluster (see the README).

- Fixture runs of `selector-mismatch`, `application-bug` and `broken-readiness` end to end: baseline, injection, fault proof, investigation, real policy-checked writes as the agent ServiceAccount, image build, kind load, rollout, and hidden verification.
- The agent token is refused (403) for Secrets, other namespaces, the probe Deployment, deletes and RBAC.
- A stale proposal is rejected.
- Superficial or dangerous patches are denied against the real API.

## UI: `cd apps/web && pnpm test:e2e`

Playwright drives the real UI against a running API and kind cluster, in fixture mode. It goes from experiment setup through fault injection, investigation and resolution to the report and Markdown export. The API must be running (`uv run kubetrace serve`).

## Live model (opt-in)

`uv run kubetrace preflight` checks the endpoint. A live scenario is `uv run kubetrace run <scenario> --model-mode live`. Live runs cost tokens and are never part of the default test suite.
