# Recording script: three experiments (about 8 minutes)

Record at 1600×1000 or larger, browser zoom 100 %, dark UI. Turn on **Presentation mode** on report pages so cluster addresses and registry names are hidden.

Before recording:

1. **Model check.** Run `uv run kubetrace preflight`. All checks should pass. Say which model the run uses: today that is `meta-models/muse-spark-open`. **Do not call it Beam** until Beam is listed in the Token Factory catalog and the preflight passes with it.
2. **Cluster.** Connect the Civo cluster (header badge: *Civo · … · v1.35*).
3. **Prime.** Press **Setup** on the three scenarios once beforehand, so the first image pulls are cached, then **Reset** them.

## 0. Opening (30 s)

> "This is KubeTrace. A real Civo cluster, a small storefront service, and an agent running on Nebius Token Factory. We will break the service three ways and watch the agent find and fix each one. Hidden checks it never sees will decide whether it worked."

Show the **Cluster** tab: the healthy topology. Point at the legend: solid edges are reported by the Kubernetes API, and dashed edges are inferred from selectors.

## 1. Service selector mismatch (2 min)

1. Open **Experiments → Service selector mismatch → Setup**. Wait for *Baseline healthy*, then press **Inject**.
2. Switch to the **Cluster** tab. The Service turns red with 0 endpoints, while the Pods stay green.
   > "Every checkout fails, but nothing is crashing."
3. Press **Investigate** (Live model on, Demo auto-fix on). In the timeline:
   - `http_check` reproduces the failure;
   - `service_endpoints` shows a selector of `storefront-api` against Pods labelled `storefront`;
   - a **hypothesis** card appears;
   - the patch to `k8s/service.yaml` is shown;
   - **Applied**: dry run, policy check, then write.
4. Stop on **Independent verification passed**: selector, endpoints, three real checkouts, and the manifest matching the live object.

## 2. The flagship: a code bug (3–4 min)

1. Run **Checkout bug needs a code fix → Setup → Inject**. The fault proof shows a 30-unit order returning HTTP 500 while a 2-unit order returns 200.
2. Press **Investigate**. Narrate the timeline:
   - **Reproduce:** `http_check` with 30 mugs returns 500.
   - **Evidence:** `get_logs` shows `IndexError` in `bulk_rate`; `read_file` covers `storefront/pricing.py` and `docs/pricing.md`.
   - **Hypothesis:** the tier index runs past the end of the table.
   - **Patch:** open the diff (Patch tab). The fix follows the documented rule: 20 or more units get 10 %.
   - **Regression test:** a new file under `tests/`.
   - **Tests:** the sandbox runs them with no network, no credentials and no Docker socket. Open the output.
   - **Build:** a new immutable image (digest on Civo).
   - **Deploy:** the rollout, then the agent's own `http_check` returns 200.
3. **Verification tab.** Walk through the hidden checks:
   - six checkout totals, including 45 and 500 units;
   - the hidden pricing tests;
   - no swallowed exception;
   - the agent's test **fails on the buggy code**, so it really tests the bug;
   - the original tests are kept;
   - the manifest records the deployed image.

   > "A restart, a try/except, or a weakened test would all fail here."

## 3. Broken readiness probe (1.5 min)

1. **Setup → Inject.** The rollout is stuck and the new Pods are Running but not Ready, while the old Pods still serve.
2. **Investigate.** Events show `Readiness probe failed: HTTP 404`, and the agent reads `docs/operations.md`. The patch changes `/ready` to `/readyz`, and the rollout completes.
3. Optional: show policy refusing a shortcut. Switch to **Review each change** and reject the agent's first proposal to show the approval card. Or point at the unit tests in `tests/unit/test_policy.py`, where removing the probe or using an `exec` probe is denied.

## 4. Report (1 min)

Open **Report** on the code-fix run with Presentation mode on. Show:

- provenance: *Live · Civo*, the exact model id and the generation settings;
- the attempted changes, including any denied ones;
- the tests with their real output;
- the verification checks;
- tokens, model time, tool time, and the cost estimate with its rate source.

Then export it as Markdown.

> "Everything on this page came from this run's own artifacts."

## Don'ts

- Don't cut out failed attempts or denied changes; the report shows them anyway.
- Don't present a fixture run (orange FIXTURE badge) as model output.
- Don't quote Beam's benchmark numbers as KubeTrace results. If you mention them, say they are provider-reported and link the source.
