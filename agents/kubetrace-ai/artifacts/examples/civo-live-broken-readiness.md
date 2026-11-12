# KubeTrace run 20261016-184728-27677b: broken-readiness

> **Live run on a Civo cluster**

**Outcome:** resolved. independent verification passed (reconstructed from recorded events)  
**First-attempt success:** True · **Eventual success:** True  
**Provider:** nebius-token-factory · **Model:** `meta-models/muse-spark-open` · **Policy mode:** auto  
**Repository commit:** 6f8bbd81cc2d

**Generation settings:** `{"max_tokens": 2048, "temperature": 0.2}`  
**Prompt / tool schema versions:** 2026-10-16.1 / 2026-10-16.1

## Cluster
- Kind: civo · Kubernetes v1.35.0+k3s1 · context [hidden]
- Capacity: [{"name": "k3s-kubetrace-demo-cc91-52bf34-node-pool-b14e-2zv2y", "cpu": "1880m", "memory": "2364008Ki"}, {"name": "k3s-kubetrace-demo-cc91-52bf34-node-pool-b14e-ve391", "cpu": "1880m", "memory": "2364020Ki"}]

## Issue
**Incident:** Storefront Pods never become ready  
**Symptom:** The rollout is stuck: new Pods run with zero restarts but never become Ready; the release never goes live.

Baseline (healthy, before injection):
- ✅ **storefront and probe rolled out**: Deployments available
- ✅ **checkout [{"sku": "MUG-01", "qty": 2}]**: HTTP 200, total 31.92, expected 31.92
- ✅ **checkout [{"sku": "CAP-03", "qty": 12}]**: HTTP 200, total 227.77, expected 227.77
- ✅ **checkout [{"sku": "TEE-02", "qty": 1}, {"sku": "STK-04", "qty": 3}] SAVE10**: HTTP 200, total 41.72, expected 41.72

Fault confirmed before investigation:
- ✅ **new Pods run but are not Ready**: Pods with the /ready probe are Running, not Ready
- ✅ **rollout is not completing**: updated 1, ready 2, unavailable 1

## Evidence and hypotheses
- *Observation:* New Pod storefront-74c8c967c8-xpdkt fails readiness probe with 404 on /ready, while old Pods serve /readyz successfully. Manifest k8s/deployment.yaml has readinessProbe path /ready which does not exist in app (server.py implements /readyz and /healthz per docs/operations.md). (get_events Warning Unhealthy Readiness probe failed: HTTP probe failed with statuscode: 404 for Pod/storefront-74c8c967c8-xpdkt, get_logs storefront-74c8c967c8-xpdkt GET /ready 404 vs GET /healthz 200, get_logs storefront-7c5f6ddb74-2rkzs GET /readyz 200, read_file k8s/deployment.yaml readinessProbe path /ready, read_file storefront/server.py Handler.do_GET handles /healthz and /readyz only, read_file docs/operations.md endpoint table)

## Attempted changes
### apply_manifest Deployment/storefront: denied
Reason: Fix readiness probe path to /readyz so new Pods become ready

Policy: server-side dry run rejected it: Deployment in version "v1" cannot be handled as a Deployment: json: cannot unmarshal array into Go struct field PodSpec.spec.template.spec.automountServiceAccountToken of type bool

Error: Deployment in version "v1" cannot be handled as a Deployment: json: cannot unmarshal array into Go struct field PodSpec.spec.template.spec.automountServiceAccountToken of type bool

### apply_manifest Deployment/storefront: applied
Reason: Fix readiness probe path to /readyz so new Pods become ready

```diff
--- live/deployment/storefront
+++ proposed/deployment/storefront
@@ -51,7 +51,7 @@
         readinessProbe:
           failureThreshold: 2
           httpGet:
-            path: /ready
+            path: /readyz
             port: http
             scheme: HTTP
           periodSeconds: 3
```


## Tests
No tests were run.

## Rollouts
- storefront: complete=True after 1.1 s (2/2 ready)

## Independent verification
Attempt 1 (agent said resolved): passed
- ✅ **readiness probe checks /readyz over HTTP**: readinessProbe {"failureThreshold": 2, "httpGet": {"path": "/readyz", "port": "http", "scheme": "HTTP"}, "periodSeconds": 3, "successThreshold": 1, "timeoutSeconds": 1}
- ✅ **rollout complete**: all replicas updated and ready
- ✅ **pods ready and stable**: 2/2 Ready; restarts 0→0 over 5 s
- ✅ **service endpoints**: 2 ready endpoints
- ✅ **checkout [{"sku": "MUG-01", "qty": 2}]**: HTTP 200, total 31.92, expected 31.92
- ✅ **checkout [{"sku": "CAP-03", "qty": 12}]**: HTTP 200, total 227.77, expected 227.77
- ✅ **checkout [{"sku": "TEE-02", "qty": 1}, {"sku": "STK-04", "qty": 3}] SAVE10**: HTTP 200, total 41.72, expected 41.72
- ✅ **source manifest matches**: manifest readinessProbe {"httpGet": {"path": "/readyz", "port": "http"}, "periodSeconds": 3, "failureThreshold": 2}


## Measurements
- Model calls: 24 · model time 82.32 s
- Tokens: 324653 in / 7680 out / 332333 total (reported by provider)
- Tool calls: 46 (2 errors) · tool time 12.48 s
- Rejected actions: 1 · verification attempts 1
- Agent elapsed: 103.47 s
- Cost: $0.4385 (estimate; rates from Nebius Token Factory GET /v1/models?verbose=true (pricing.prompt / pricing.completion), 2026-10-16)

## Limitations
- 1 proposed change(s) were denied, rejected, stale or failed; see attempted changes.
- Metrics and outcome were reconstructed from the recorded events: the headless runner exited before saving them (fixed 2026-10-16). Verification results are the recorded ones.
