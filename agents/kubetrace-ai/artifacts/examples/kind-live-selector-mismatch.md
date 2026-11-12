# KubeTrace run 20261016-153032-873662: selector-mismatch

> **Live run on a local kind cluster**

**Outcome:** resolved. independent verification passed  
**First-attempt success:** True · **Eventual success:** True  
**Provider:** nebius-token-factory · **Model:** `meta-models/muse-spark-open` · **Policy mode:** auto  
**Repository commit:** uncommitted-dirty

**Generation settings:** `{"max_tokens": 2048, "temperature": 0.2}`  
**Prompt / tool schema versions:** 2026-10-16.1 / 2026-10-16.1

## Cluster
- Kind: kind · Kubernetes v1.27.3 · context [hidden]
- Capacity: [{"name": "kubetrace-control-plane", "cpu": "4", "memory": "16356580Ki"}]

## Issue
**Incident:** Storefront checkout is down  
**Symptom:** Checkout requests through the Service fail; the Service has no endpoints while Pods are healthy.

Baseline (healthy, before injection):
- ✅ **storefront and probe rolled out**: Deployments available
- ✅ **checkout [{"sku": "MUG-01", "qty": 2}]**: HTTP 200, total 31.92, expected 31.92
- ✅ **checkout [{"sku": "CAP-03", "qty": 12}]**: HTTP 200, total 227.77, expected 227.77
- ✅ **checkout [{"sku": "TEE-02", "qty": 1}, {"sku": "STK-04", "qty": 3}] SAVE10**: HTTP 200, total 41.72, expected 41.72

Fault confirmed before investigation:
- ✅ **no ready endpoints**: 0 endpoints
- ✅ **request through the Service fails**: {"ok": false, "error": "URLError: [Errno 111] Connection refused", "latency_ms": 0}

## Evidence and hypotheses
- *Observation:* Service selector mismatch causes all requests to fail: Service selects storefront-api but Pods are labeled storefront, so endpoints empty and http_check gets connection refused. Pods themselves handle checkout correctly per logs. (service_endpoints pods_matching_selector=[] endpoints=[], get_resource Service selector storefront-api, get_resource Deployment template labels storefront, http_check Connection refused, get_logs checkout ok total=31.92)

**Agent conclusion (resolved):** Service selector mismatch: Service selected app.kubernetes.io/name=storefront-api but Pods are labeled storefront, so EndpointSlices were empty and every request failed with connection refused.

Fixed k8s/service.yaml selector from storefront-api to storefront and applied it. Verified endpoints now contain both Pods ([ip], [ip]) and http_check through Service succeeds for /api/catalog, /healthz, and POST /api/checkout (total 31.92).

## Attempted changes
### apply_manifest Service/storefront: applied
Reason: Apply corrected Service selector so endpoints populate and checkout recovers

```diff
--- live/service/storefront
+++ proposed/service/storefront
@@ -20,6 +20,6 @@
     protocol: TCP
     targetPort: http
   selector:
-    app.kubernetes.io/name: storefront-api
+    app.kubernetes.io/name: storefront
   sessionAffinity: None
   type: ClusterIP
```


## Source diff (workspace, from the incident commit)
```diff
diff --git a/k8s/service.yaml b/k8s/service.yaml
index 8f280b5..ea35d4b 100644
--- a/k8s/service.yaml
+++ b/k8s/service.yaml
@@ -7,7 +7,7 @@ metadata:
     kubetrace.ai/experiment: "true"
 spec:
   selector:
-    app.kubernetes.io/name: storefront-api
+    app.kubernetes.io/name: storefront
   ports:
     - name: http
       port: 80
```

## Tests
### `python -m pytest -q -p no:cacheprovider tests`: exit 0 (passed, 0.46 s)
Isolation: docker: --network none, read-only source, no credentials, no Docker socket
```
.............                                                            [100%]
13 passed in 0.02s
```

## Independent verification
Attempt 1 (agent said resolved): passed
- ✅ **selector matches the storefront Pods**: selector {'app.kubernetes.io/name': 'storefront'}, pod labels {'app.kubernetes.io/name': 'storefront', 'kubetrace.ai/experiment': 'true'}
- ✅ **rollout complete**: all replicas updated and ready
- ✅ **pods ready and stable**: 2/2 Ready; restarts 0→0 over 3 s
- ✅ **service endpoints**: 2 ready endpoints
- ✅ **checkout [{"sku": "MUG-01", "qty": 2}]**: HTTP 200, total 31.92, expected 31.92
- ✅ **checkout [{"sku": "CAP-03", "qty": 12}]**: HTTP 200, total 227.77, expected 227.77
- ✅ **checkout [{"sku": "TEE-02", "qty": 1}, {"sku": "STK-04", "qty": 3}] SAVE10**: HTTP 200, total 41.72, expected 41.72
- ✅ **source manifest matches the live selector**: manifest {'app.kubernetes.io/name': 'storefront'}


## Measurements
- Model calls: 14 · model time 103.15 s
- Tokens: 243279 in / 6065 out / 249344 total (reported by provider)
- Tool calls: 38 (0 errors) · tool time 1.2 s
- Rejected actions: 0 · verification attempts 1
- Agent elapsed: 107.67 s
- Cost: $0.3299 (estimate; rates from Nebius Token Factory GET /v1/models?verbose=true (pricing.prompt / pricing.completion), 2026-10-16)

## Limitations
- None recorded.
