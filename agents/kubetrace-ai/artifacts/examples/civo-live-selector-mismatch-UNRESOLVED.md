# KubeTrace run 20261016-184008-c142dd: selector-mismatch

> **Live run on a Civo cluster**

**Outcome:** unresolved. a step or token limit was reached (the events do not record which) (reconstructed from recorded events)  
**First-attempt success:** None · **Eventual success:** False  
**Provider:** nebius-token-factory · **Model:** `meta-models/muse-spark-open` · **Policy mode:** auto  
**Repository commit:** 712b98548ed0-dirty

**Generation settings:** `{"max_tokens": 2048, "temperature": 0.2}`  
**Prompt / tool schema versions:** 2026-10-16.1 / 2026-10-16.1

## Cluster
- Kind: civo · Kubernetes v1.35.0+k3s1 · context [hidden]
- Capacity: [{"name": "k3s-kubetrace-demo-cc91-52bf34-node-pool-b14e-2zv2y", "cpu": "1880m", "memory": "2364008Ki"}, {"name": "k3s-kubetrace-demo-cc91-52bf34-node-pool-b14e-ve391", "cpu": "1880m", "memory": "2364020Ki"}]

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
- ✅ **request through the Service fails**: {"ok": false, "error": "URLError: [Errno 111] Connection refused", "latency_ms": 5}

## Evidence and hypotheses

## Attempted changes
None.

## Tests
No tests were run.

## Independent verification
Not reached.

## Measurements
- Model calls: 30 · model time 130.36 s
- Tokens: 597560 in / 10442 out / 608002 total (reported by provider)
- Tool calls: 96 (0 errors) · tool time 10.13 s
- Rejected actions: 0 · verification attempts 0
- Agent elapsed: 141.07 s
- Cost: $0.7913 (estimate; rates from Nebius Token Factory GET /v1/models?verbose=true (pricing.prompt / pricing.completion), 2026-10-16)

## Limitations
- Metrics and outcome were reconstructed from the recorded events: the headless runner exited before saving them (fixed 2026-10-16). Verification results are the recorded ones.
