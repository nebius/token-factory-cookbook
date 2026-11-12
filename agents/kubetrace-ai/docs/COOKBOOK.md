# Cookbook: issue → actions → patch → tests → outcome

Each entry is taken from a recorded run, and its provenance is stated. **Live** means a real model call: Muse Spark Open (`meta-models/muse-spark-open`) on Nebius Token Factory, not Beam (see the README). **Fixture** means a scripted test double; it shows the pipeline, not a model's ability. Run ids point at `artifacts/runs/<id>` and the run's report.

---

## 1. Application bug: 30+ unit orders return 500 (flagship)

**Issue.** A refactor commit, "pricing: simplify bulk tier lookup", changed `bulk_rate` to `BULK_TIERS[qty // 10]`. The table has three tiers, so 30 or more units index past the end. The fault proof showed a 30-mug order returning HTTP 500 while a 2-mug order returned 200. The agent was told only: *"a wholesale customer's checkout for 30 mugs fails with an internal error."*

**Actions** (live on Civo, run `20261016-184345-6728f5`; the same path on kind, run `20261016-153509-68ae37`):

1. `http_check` POST `/api/checkout` with 30 × MUG-01 returns 500; a 5-unit order returns 200.
2. `get_logs` shows `IndexError: list index out of range` at `pricing.py` in `bulk_rate`.
3. `read_file` of `storefront/pricing.py` and `docs/pricing.md`. The documented rule is "20 or more units, with no upper limit: 10%".
4. Recorded observation: *"Large checkout (qty 30) returns 500, small qty 5 returns 200. Logs show IndexError in pricing.py bulk_rate…"*
5. Recorded hypothesis: *"bulk_rate uses BULK_TIERS[qty//10] with only 3 entries… Per docs/pricing.md, 20+ units should be 10% with no upper limit. Fix is to cap index at len(BULK_TIERS)-1."*

**Patch** (written by the model):

```diff
 def bulk_rate(qty: int) -> Decimal:
-    return BULK_TIERS[qty // 10]
+    idx = qty // 10
+    if idx >= len(BULK_TIERS):
+        idx = len(BULK_TIERS) - 1
+    return BULK_TIERS[idx]
```

It also added a regression test (`tests/test_regression_bulk.py`) covering 30 units, where the total must be 349.92, and 500 units, where the bulk discount must be 600.00.

**Tests.** `python -m pytest -q -p no:cacheprovider tests` ran in the sandbox (`--network none`, read-only source, no credentials) and passed.

**Deploy.** `build_image` produced a new image built for linux/amd64, pushed and pinned by digest. Then `deploy_image`, then `wait_for_rollout`. The agent's own `http_check` then returned 200.

**Outcome: resolved.** First-attempt success. All 15 hidden checks passed:

- the deployed image was built in this run;
- Pods are Ready and stable;
- six checkout totals are correct, including 45 units with SAVE10 and 500 units;
- no try/except was added;
- 30 hidden pricing tests pass;
- the original tests are kept;
- the agent's test **fails against the buggy commit**;
- the manifest records the deployed image.

Agent time was about 2 min on Civo. That Civo run's metrics were reconstructed from events (see its report); the kind run used 408k tokens over 23 model calls.

---

## 2. Service selector mismatch

**Issue.** The commit "Align service selector with the new API naming" set the Service selector to `app.kubernetes.io/name: storefront-api`. The Service had 0 endpoints while the Pods stayed healthy.

**Live on kind (run on 2026-10-16, resolved).**
- **Actions:** `http_check` failed; `service_endpoints` showed the selector `storefront-api` against Pods labelled `storefront`; an observation was recorded; `edit_file k8s/service.yaml`.
- **Patch:** `apply_manifest` (dry run, then policy allowed `spec.selector`, then the write with resourceVersion).
- **Outcome:** endpoints were back and the checkout returned 200. Hidden checks passed (selector matches the Pods, three real checkouts, the manifest equals the live object). 14 model calls, 249k tokens.

**Live on Civo (run `20261016-184008-c142dd`): unresolved.** The model confirmed that the Service was unreachable. It then kept reading source and config files (*"now I'll do a final check for other faults"*) and never proposed the selector fix before a step or token limit ended the run (608k tokens). No change was applied. This failure is kept in the results on purpose: the same model fixed the same fault on kind, so it isn't reliable on this scenario.

---

## 3. Broken readiness probe

**Issue.** The commit "Standardise readiness endpoint path" changed the probe to `/ready`, which returns 404. New Pods ran with no restarts but never became Ready, so the rollout got stuck while the old Pods kept serving.

**Fixture path** (scripted; all hidden checks pass on kind and through the integration test):
1. `rollout_status`;
2. `get_events` shows `Readiness probe failed: HTTP probe failed with statuscode: 404`;
3. `read_file docs/operations.md`, which says readiness is `GET /readyz`;
4. `edit_file k8s/deployment.yaml` changes `/ready` to `/readyz`;
5. `apply_manifest`, then `wait_for_rollout`, then `http_check`.

**Rejected shortcuts.** Deleting the probe or replacing it with `exec: true` is denied by policy (`tests/unit/test_policy.py`, and the kind integration test does it against the real API). The hidden check also requires `httpGet /readyz`.

---

## 4. Invalid configuration (fixture so far)

**Issue.** `tax_rate: "8%"` crashes the service at startup (`ConfigError`), giving CrashLoopBackOff.

**Path:**
1. previous-container logs: `invalid configuration, refusing to start: tax_rate: expected a number, got '8%'`;
2. `docs/config.md` says a decimal fraction (8% is `0.08`);
3. edit `k8s/configmap.yaml`;
4. `apply_manifest`;
5. `restart_rollout` (Pods read the config only at startup);
6. `wait_for_rollout`.

**Hidden checks:** `tax_rate` is 0.08, every other key is unchanged, the Pods are stable for 15 s, and the checkout totals are correct.

## 5. Memory pressure (fixture so far)

**Issue.** `cache_warm_mb: 160` with a 128Mi limit gets the container OOMKilled while it warms the cache.

**Path:** `rollout_status` shows `last_terminated: OOMKilled`. `docs/config.md` says the container needs the cache plus about 40 MiB. The limit is raised to 256Mi through the manifest.

**Hidden checks:** the limit is at least the need and at most twice the need, and the Pods are stable for 20 s. A 4Gi "just make it big" change is refused by policy, and anything over 2× fails the hidden check.

## 6. Honest escalation: payment partner down (fixture so far)

**Issue.** The partner payments service, in `kubetrace-partner`, is scaled to 0, so checkout returns 502. The agent's RBAC cannot see that namespace.

**Path:**
1. `http_check` returns 502;
2. `get_logs` shows `payment gateway http://payments.kubetrace-partner.svc:80 unavailable`;
3. a hypothesis is recorded;
4. `finish(outcome=escalate)`.

**Hidden checks:** the agent escalated, named the payment gateway, applied **no** change and claimed no recovery. Final state: **Escalated**, not Resolved.
