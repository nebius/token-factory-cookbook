#!/usr/bin/env bash
# Live end-to-end group grocery run against the running server (Nebius, Cognee, Firedrill Stripe/Slack).
set -euo pipefail
B=${B:-localhost:8700}
J() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
post() { curl -s -m 300 -XPOST "$B$1" -H "Content-Type: application/json" -d "${2:-{\}}"; }
post /api/g/reset >/dev/null
echo "== requests (Nebius extraction)"
post "/api/g/requests?member=shivay" '{"text":"We need laundry detergent for the flat, fragrance-free please"}' | J 'print(" ", d.get("item"), d.get("allocation"), d.get("quantity"), d.get("unit"), d.get("constraints"), d.get("engine"))'
post "/api/g/requests?member=dad" '{"text":"can we get detergent too"}' | J 'print(" ", d.get("item"), d.get("allocation"), d.get("quantity"), d.get("unit"), d.get("constraints"), d.get("engine"))'
post "/api/g/requests?member=shivay" '{"text":"1 gallon of whole milk for me"}' | J 'print(" ", d.get("item"), d.get("allocation"), d.get("quantity"), d.get("unit"), d.get("constraints"))'
post "/api/g/requests?member=dad" '{"text":"2 cartons of oat milk for me"}' | J 'print(" ", d.get("item"), d.get("allocation"), d.get("quantity"), d.get("unit"), d.get("constraints"))'
post "/api/g/requests?member=dad" '{"text":"a dozen eggs for the flat"}' | J 'print(" ", d.get("item"), d.get("allocation"), d.get("quantity"), d.get("unit"), d.get("constraints"))'
echo "== preference (shared value, private reason)"
post "/api/g/prefs?member=dad" '{"subject":"laundry detergent","value":"fragrance-free","hard":true,"visibility":"group","private_reason":"skin condition"}' | J 'print(" saved", d["subject"], d["value"])'
curl -s "$B/api/g/snapshot?member=shivay" | J 'print("  shivay sees reason?", any(p.get("private_reason") for p in d["preferences"]))'
echo "== mode: everyone pays their share"
post "/api/g/mode?member=dad" '{"mode":"individual_shares"}' | J 'print(" ", d)' || true
post "/api/g/mode?member=shivay" '{"mode":"individual_shares"}' | J 'print("  mode", d["payment_mode"], "version", d["version"])'
echo "== plan"
post "/api/g/plan?member=shivay" | J '
print("  lines:", [(l["item"], l["allocation"], l["quantity"], l.get("per_member")) for l in d["lines"]])
for q in d["quotes"]: print("  quote", q["retailer"], "feasible" if q["feasible"] else "NOT feasible: "+q["reason"], q.get("total"), q.get("unknown"))
print("  recommended:", d["recommended"]); [print("  why:", w) for w in d["why"]]
print("  allocations:", [(a["member"], a["amount"]) for a in d["allocations"]]); open("/tmp/plan.json","w").write(json.dumps(d))'
PID=$(python3 -c "import json; print(json.load(open('/tmp/plan.json'))['id'])")
echo "== approvals"
for m in shivay dad; do
  AMT=$(python3 -c "import json; print(next(a['amount'] for a in json.load(open('/tmp/plan.json'))['allocations'] if a['member']=='$m'))")
  post "/api/g/approve?member=$m" "{\"plan_id\":\"$PID\",\"limit\":\"$AMT\"}" | J 'print("  ", d)'
done
echo "== execute (authorize each payer, synthetic order, capture)"
post "/api/g/execute?member=shivay" | J 'print("  state", d["state"]); [print("  pay", p["member"], p["amount"], p["intent"], p["state"]) for p in d["payments"]]; print("  order", d.get("order"))'
echo "== duplicate execute"
post "/api/g/execute?member=shivay" | J 'print("  state", d["state"], "attempt", d["attempt"])'
echo "== refund"
post "/api/g/refund?member=shivay" | J '[print("  ", p["member"], p["state"], p.get("refund")) for p in d["payments"]]'
echo "== declined card path"
post /api/g/reset >/dev/null
post "/api/g/requests?member=shivay" '{"text":"We need laundry detergent for the flat"}' >/dev/null
post "/api/g/requests?member=dad" '{"text":"1 gallon of milk for me"}' >/dev/null
post "/api/g/requests?member=shivay" '{"text":"a dozen eggs for the flat"}' >/dev/null
post "/api/g/requests?member=shivay" '{"text":"2 loaves of bread for me"}' >/dev/null
post "/api/g/mode?member=shivay" '{"mode":"individual_shares"}' >/dev/null
post "/api/g/plan?member=shivay" > /tmp/plan2.json
PID=$(python3 -c "import json; print(json.load(open('/tmp/plan2.json'))['id'])")
for m in shivay dad; do
  AMT=$(python3 -c "import json; print(next(a['amount'] for a in json.load(open('/tmp/plan2.json'))['allocations'] if a['member']=='$m'))")
  post "/api/g/approve?member=$m" "{\"plan_id\":\"$PID\",\"limit\":\"$AMT\"}" >/dev/null
done
post "/api/g/execute?member=shivay&test_decline_for=dad" | J 'print("  state", d["state"]); [print("  pay", p["member"], p["state"], p["error"]) for p in d["payments"]]'
curl -s "$B/api/g/snapshot?member=shivay" | J 'print("  run state:", d["run"]["state"]); [print("  audit:", a["decision"][:120]) for a in d["audit"][-4:]]'
