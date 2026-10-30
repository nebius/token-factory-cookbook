# KubeTrace run 20261016-153509-68ae37: application-bug

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
**Incident:** Large checkout orders fail with 500  
**Symptom:** POST /api/checkout returns HTTP 500 for orders of 30 or more units of one item; smaller orders work.

Baseline (healthy, before injection):
- ✅ **storefront and probe rolled out**: Deployments available
- ✅ **checkout [{"sku": "MUG-01", "qty": 2}]**: HTTP 200, total 31.92, expected 31.92
- ✅ **checkout [{"sku": "CAP-03", "qty": 12}]**: HTTP 200, total 227.77, expected 227.77
- ✅ **checkout [{"sku": "TEE-02", "qty": 1}, {"sku": "STK-04", "qty": 3}] SAVE10**: HTTP 200, total 41.72, expected 41.72

Fault confirmed before investigation:
- ✅ **30-unit order returns 500**: HTTP 500
- ✅ **small order still works**: HTTP 200

## Evidence and hypotheses
- *Observation:* Large checkout (qty 30) returns 500, small (qty 5) succeeds. Logs show IndexError in bulk_rate: BULK_TIERS[qty//10] out of range for qty 30. (http_check storefront /api/checkout qty30 500, http_check qty5 200, logs storefront-54b87754b-8w94s IndexError list index out of range at pricing.py:43)
- *Hypothesis:* bulk_rate uses BULK_TIERS[qty//10] with only 3 entries (indices 0,1,2). For qty>=30, index 3+ out of range. Should cap at last tier per docs: 20+ units = 10%. (pricing.py:15 BULK_TIERS length 3, pricing.py:43 bulk_rate qty//10, docs/pricing.md 20 or more units 10%, logs IndexError for qty 30)

**Agent conclusion (resolved):** Code bug in storefront/pricing.py bulk_rate(): BULK_TIERS has 3 entries (0%,5%,10%) but indexing was BULK_TIERS[qty//10] without capping. For qty 30, index 3 out of range -> IndexError -> 500. Per docs/pricing.md, 20+ units should be 10%.

Fixed bulk_rate to cap index at len(BULK_TIERS)-1, added regression test for qty 30 and 500, built and deployed new image kubetrace/storefront:20261016-153509-68ae37-0b0acd84-b1. Verified checkout for 30 mugs now returns 200 with correct totals (360 gross, 36 discount, 349.92 total) and 500 qty also succeeds; rollout complete with 2 ready pods.

## Attempted changes
### deploy_image Deployment/storefront: applied
Reason: Deploy fix for large checkout 500

```diff
--- live/deployment/storefront
+++ proposed/deployment/storefront
@@ -30,8 +30,8 @@
       containers:
       - env:
         - name: APP_VERSION
-          value: release-a3b55329808e
-        image: kubetrace/storefront:release-a3b55329808e
+          value: 20261016-153509-68ae37-0b0acd84-b1
+        image: kubetrace/storefront:20261016-153509-68ae37-0b0acd84-b1
         imagePullPolicy: IfNotPresent
         livenessProbe:
           failureThreshold: 3
```


## Source diff (workspace, from the incident commit)
```diff
diff --git a/k8s/deployment.yaml b/k8s/deployment.yaml
index 4bf06e8..955173d 100644
--- a/k8s/deployment.yaml
+++ b/k8s/deployment.yaml
@@ -23,7 +23,7 @@ spec:
         runAsUser: 10001
       containers:
         - name: storefront
-          image: kubetrace/storefront:release-a3b55329808e
+          image: kubetrace/storefront:20261016-153509-68ae37-0b0acd84-b1
           imagePullPolicy: IfNotPresent
           ports:
             - name: http
diff --git a/storefront/pricing.py b/storefront/pricing.py
index 95ff59a..3ebc77e 100644
--- a/storefront/pricing.py
+++ b/storefront/pricing.py
@@ -40,7 +40,10 @@ def money(value: Decimal) -> Decimal:
 
 
 def bulk_rate(qty: int) -> Decimal:
-    return BULK_TIERS[qty // 10]
+    idx = qty // 10
+    if idx >= len(BULK_TIERS):
+        idx = len(BULK_TIERS) - 1
+    return BULK_TIERS[idx]
 
 
 def quote(items: list[dict], coupon: str | None, config: PricingConfig) -> dict:
diff --git a/tests/test_bulk_regression.py b/tests/test_bulk_regression.py
new file mode 100644
index 0000000..03ef74a
--- /dev/null
+++ b/tests/test_bulk_regression.py
@@ -0,0 +1,17 @@
+from decimal import Decimal
+from storefront.pricing import PricingConfig, quote
+
+CFG = PricingConfig(currency="USD", tax_rate=Decimal("0.08"), shipping_flat=Decimal("6.00"),
+                    free_shipping_threshold=Decimal("75"))
+
+def test_bulk_30_mugs_ten_percent():
+    # 30 * 12.00 = 360.00 gross, 10% bulk = 36.00, after_bulk 324, free shipping, tax 25.92, total 349.92
+    q = quote([{"sku": "MUG-01", "qty": 30}], None, CFG)
+    assert q["bulk_discount"] == "36.00"
+    assert q["shipping"] == "0.00"
+    assert q["total"] == "349.92"
+
+def test_bulk_500_max_qty():
+    q = quote([{"sku": "MUG-01", "qty": 500}], None, CFG)
+    # 500*12=6000 gross, 10% =600 discount
+    assert q["bulk_discount"] == "600.00"
```

## Tests
### `python -m pytest -q -p no:cacheprovider tests`: exit 0 (passed, 0.49 s)
Isolation: docker: --network none, read-only source, no credentials, no Docker socket
```
...............                                                          [100%]
15 passed in 0.02s
```

## Images built
- `kubetrace/storefront:20261016-153509-68ae37-0b0acd84-b1` from commit 0b0acd84ea (3.7 s)

## Rollouts
- storefront: complete=True after 3.1 s (2/2 ready)

## Independent verification
Attempt 1 (agent said resolved): passed
- ✅ **running a new image built in this run**: deployment image kubetrace/storefront:20261016-153509-68ae37-0b0acd84-b1
- ✅ **rollout complete**: all replicas updated and ready
- ✅ **pods ready and stable**: 2/2 Ready; restarts 0→0 over 5 s
- ✅ **service endpoints**: 2 ready endpoints
- ✅ **checkout [{"sku": "MUG-01", "qty": 2}]**: HTTP 200, total 31.92, expected 31.92
- ✅ **checkout [{"sku": "CAP-03", "qty": 12}]**: HTTP 200, total 227.77, expected 227.77
- ✅ **checkout [{"sku": "TEE-02", "qty": 1}, {"sku": "STK-04", "qty": 3}] SAVE10**: HTTP 200, total 41.72, expected 41.72
- ✅ **checkout [{"sku": "MUG-01", "qty": 30}]**: HTTP 200, total 349.92, expected 349.92
- ✅ **checkout [{"sku": "TEE-02", "qty": 45}] SAVE10**: HTTP 200, total 944.78, expected 944.78
- ✅ **checkout [{"sku": "CAP-03", "qty": 500}]**: HTTP 200, total 8991.00, expected 8991.00
- ✅ **no exception handling added to hide the error**: added lines: no try/except added in storefront/
- ✅ **hidden pricing tests pass on the final source**: ...............................                                          [100%]
31 passed in 0.03s

- ✅ **original tests kept**: every original test function is still present
- ✅ **agent-added regression test fails on the buggy code**: tests added: tests/test_bulk_regression.py; on buggy code exit 1
- ✅ **source manifest records the deployed image**: manifest kubetrace/storefront:20261016-153509-68ae37-0b0acd84-b1


## Measurements
- Model calls: 23 · model time 198.38 s
- Tokens: 400035 in / 8047 out / 408082 total (reported by provider)
- Tool calls: 66 (0 errors) · tool time 9.11 s
- Rejected actions: 0 · verification attempts 1
- Agent elapsed: 214.17 s
- Cost: $0.5342 (estimate; rates from Nebius Token Factory GET /v1/models?verbose=true (pricing.prompt / pricing.completion), 2026-10-16)

## Limitations
- None recorded.
