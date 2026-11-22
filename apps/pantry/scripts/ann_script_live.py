"""Run Ann's demo script end to end against a running server (live model). Usage: python ann_script_live.py <base_url>"""
import sys
import time

import httpx

B = sys.argv[1].rstrip("/")
c = httpx.Client(timeout=240)


def call(method, path, member=None, body=None):
    url = f"{B}{path}" + (f"?member={member}" if member else "")
    r = c.request(method, url, json=body if method == "POST" else None)
    j = r.json()
    if r.status_code >= 400:
        print(f"   ! {path} {r.status_code}: {j.get('detail')}")
    return j


print("Scene 1-3 · household and invites")
call("POST", "/api/g/reset?fresh=1")
call("POST", "/api/g/household", "ann", {"name": "Maple House", "payment_mode": "individual_shares",
                                         "how_often": "Weekly, Saturday", "requests_close": "Friday, 5 PM",
                                         "window": "Saturday, 10 AM-12 PM"})
for name in ("Shivay", "Yash", "Shane"):
    inv = call("POST", "/api/g/invite", "ann", {"name": name, "email": f"{name.lower()}@example.test"})
    print(f"   invited {name}: status={inv.get('status')} email_sent={inv.get('email_sent')}")
    j = call("POST", "/api/g/join", body={"code": inv["join_link"].split("join=")[1]})
    print(f"   {j.get('name')} joined; personal MCP link issued={bool(j.get('mcp_url'))}")

print("Scene 4 · Ann's profile")
call("POST", "/api/g/profile", "ann", {"allergies": ["dairy"], "diet": ["gluten-free"],
                                       "always_get": ["Unsweetened oat milk"], "share_with_group": True})

print("Scenes 5-7 · conversation")
lines = [("ann", "We need milk."), ("ann", "Oatly. One carton, just for me."), ("ann", "Saturday's run is fine."),
         ("ann", "And bread. The Canyon Bakehouse white one."), ("ann", "Yes."),
         ("ann", "Also a dozen eggs for the house. Vital Farms, pasture-raised."),
         ("shivay", "Plain Greek yogurt, the big Chobani tub. Just for me."), ("shivay", "Non-fat."),
         ("yash", "Peet's Major Dickason's, ground, the small bag. Just for me.")]
for m, t in lines:
    t0 = time.time()
    r = call("POST", "/api/g/chat", m, {"text": t})
    tag = f" [{', '.join(r.get('tags') or [])}]" if r.get("tags") else ""
    print(f"   {m:7} > {t}\n           < {r.get('reply')}{tag}  ({time.time()-t0:.1f}s)")

s = call("GET", "/api/g/snapshot", "ann")
print(f"Scene 8 · list: {len(s['requests'])} items; Ann's: {sum(r['author'] == 'ann' for r in s['requests'])}")

print("Scene 9 · last call (Shane stays silent)")
call("POST", "/api/g/lastcall", "ann", {"minutes": 0.25})
for m in ("ann", "shivay", "yash"):
    call("POST", "/api/g/done", m)
for _ in range(40):
    s = call("GET", "/api/g/snapshot", "ann")
    if s["plan"]:
        break
    time.sleep(3)
p = s["plan"]
print("Scene 10 · the shop:", s["run"]["state"], "| recommended:", p and p["recommended"])
for q in (p or {}).get("quotes", []):
    print(f"   {q['retailer']:20} feasible={q['feasible']} covered={q.get('covered')} items=${q.get('total')} reason={q.get('reason') or '-'}")
print("   split:", (p or {}).get("split", {}).get("note"))
print("   shares:", [(a["member"], a["amount"]) for a in (p or {}).get("allocations", [])])
print("   cutoff audit:", [a["decision"] for a in s["audit"] if "Requests closed" in a["decision"]])

print("Scene 11 · approvals")
for a in (p or {}).get("allocations", []):
    st = call("POST", "/api/g/approve", a["member"], {"plan_id": p["id"], "limit": a["amount"]})
    print(f"   {a['member']} approved -> {len(st.get('approved', []))} of {len(st.get('required', []))}")

print("Scene 12 · pay and order")
x = call("POST", "/api/g/execute", "ann")
print("   state:", x.get("state"))
for pmt in x.get("payments", []):
    print(f"   {pmt['member']:7} ${pmt['amount']:>6} {pmt['state']}")
print("   order:", (x.get("order") or {}).get("retailer"), (x.get("order") or {}).get("reference"), "|", (x.get("order") or {}).get("status"))
print("   receipts:", [(r["member"], r["ok"]) for r in x.get("receipts", [])], "| slack:", x.get("slack"))
d = call("POST", "/api/g/execute", "ann")
print("   duplicate request -> same attempt:", d.get("attempt") == x.get("attempt"))
import os
rf = {} if os.environ.get("NO_REFUND") else call("POST", "/api/g/refund", "ann")
print("   refund:", [(p["member"], p["state"]) for p in rf.get("payments", [])])
