# KubeTrace run 20261016-184345-6728f5: application-bug

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
- *Observation:* Large checkout (qty 30) returns 500, small qty 5 returns 200. Logs show IndexError in pricing.py bulk_rate: BULK_TIERS[qty//10] out of range for qty 30. (http_check POST /api/checkout qty30 500, http_check POST qty5 200, get_logs storefront-6b56b9c4c4-hkkd5 IndexError bulk_rate)
- *Hypothesis:* bulk_rate uses BULK_TIERS[qty//10] with only 3 entries (indices 0,1,2). For qty>=30, index >=3 out of range. Per docs/pricing.md, 20+ units should be 10% with no upper limit. Fix is to cap index at len(BULK_TIERS)-1. (storefront/pricing.py line 15 BULK_TIERS 3 entries, storefront/pricing.py line 43 bulk_rate, docs/pricing.md line 9 20 or more units 10%)

## Attempted changes
### deploy_image Deployment/storefront: applied
Reason: Fix bulk_rate IndexError for qty>=30 per pricing.md

```diff
--- live/deployment/storefront
+++ proposed/deployment/storefront
@@ -30,8 +30,8 @@
       containers:
       - env:
         - name: APP_VERSION
-          value: 4e62557f47902f6c4fd7ebaf9b822face8078c62b5044b5ba0a9fc80f348799
-        image: [registry]/storefront@sha256:4e62557f47902f6c4fd7ebaf9b822face8078c62b5044b5ba0a9fc80f3487992
+          value: dfcd21c1ce98d7d752e07a79239df3af69d6f6cdba3743bc6bf840566148eda
+        image: [registry]/storefront@sha256:dfcd21c1ce98d7d752e07a79239df3af69d6f6cdba3743bc6bf840566148edac
         imagePullPolicy: IfNotPresent
         livenessProbe:
           failureThreshold: 3
```


## Source diff (workspace, from the incident commit)
```diff
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
diff --git a/tests/test_regression_bulk.py b/tests/test_regression_bulk.py
new file mode 100644
index 0000000..11dda20
--- /dev/null
+++ b/tests/test_regression_bulk.py
@@ -0,0 +1,21 @@
+from decimal import Decimal
+from storefront.pricing import PricingConfig, quote
+
+CFG = PricingConfig(currency="USD", tax_rate=Decimal("0.08"), shipping_flat=Decimal("6.00"),
+                    free_shipping_threshold=Decimal("75"))
+
+def test_bulk_30_mugs_ten_percent():
+    # 30 mugs at $12 = $360 gross, 10% bulk = $36 discount, after_bulk $324, free shipping, tax 8% = $25.92, total $349.92
+    q = quote([{"sku": "MUG-01", "qty": 30}], None, CFG)
+    assert q["bulk_discount"] == "36.00"
+    assert q["shipping"] == "0.00"
+    assert q["total"] == "349.92"
+
+def test_bulk_500_max_qty():
+    q = quote([{"sku": "MUG-01", "qty": 500}], None, CFG)
+    # 500*12=6000 gross, 10% =600 discount
+    assert q["bulk_discount"] == "600.00"
+
+def test_bulk_20_boundary():
+    q = quote([{"sku": "MUG-01", "qty": 20}], None, CFG)
+    assert q["bulk_discount"] == "24.00"  # 240*0.10
```

## Tests
### `python -m pytest -q -p no:cacheprovider tests`: exit 0 (passed, 0.4 s)
Isolation: docker: --network none, read-only source, no credentials, no Docker socket
```
................                                                         [100%]
16 passed in 0.03s
```

## Images built
- `[registry]/storefront@sha256:dfcd21c1ce98d7d752e07a79239df3af69d6f6cdba3743bc6bf840566148edac` from commit 40a8595788 (22.8 s)

## Rollouts
- storefront: complete=True after 17.3 s (2/2 ready)

## Independent verification
Attempt 1 (agent said resolved): passed
- ✅ **running a new image built in this run**: deployment image [registry]/storefront@sha256:dfcd21c1ce98d7d752e07a79239df3af69d6f6cdba3743bc6bf840566148edac
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
- ✅ **hidden pricing tests pass on the final source**: ................................                                         [100%]
32 passed in 0.04s

- ✅ **original tests kept**: every original test function is still present
- ✅ **agent-added regression test fails on the buggy code**: tests added: tests/test_regression_bulk.py; on buggy code exit 1
- ✅ **source manifest records the deployed image**: manifest [registry]/storefront@sha256:dfcd21c1ce98d7d752e07a79239df3af69d6f6cdba3743bc6bf840566148edac


## Measurements
- Model calls: 21 · model time 62.28 s
- Tokens: 267585 in / 5038 out / 272623 total (reported by provider)
- Tool calls: 42 (1 errors) · tool time 48.81 s
- Rejected actions: 0 · verification attempts 1
- Agent elapsed: 122.13 s
- Cost: $0.3559 (estimate; rates from Nebius Token Factory GET /v1/models?verbose=true (pricing.prompt / pricing.completion), 2026-10-16)

## Limitations
- Metrics and outcome were reconstructed from the recorded events: the headless runner exited before saving them (fixed 2026-10-16). Verification results are the recorded ones.
