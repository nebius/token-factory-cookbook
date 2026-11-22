"""PRD acceptance checks for the group grocery run (offline: rule extraction, fake Firedrill Stripe)."""
import os
import tempfile
from decimal import Decimal

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "g.db")
os.environ["OCCASIONS_NO_DOTENV"] = "1"
for k in ("NEBIUS_API_KEY", "COGNEE_API_KEY", "SINGLESTORE_URL", "AMPLITUDE_API_KEY", "STATSIG_SERVER_SECRET"):
    os.environ.pop(k, None)

import pytest  # noqa: E402

from app import firedrill, grocery  # noqa: E402

CALLS = []


def fake_call(app, tool, args, timeout=60):
    CALLS.append((app, tool, args))
    if tool == "payment_intents.create":
        if args["payment_method"] == "pm_card_chargeDeclined":
            return {"ok": False, "data": {"error": "card_declined"}, "tool": tool}
        return {"ok": True, "data": {"id": f"pi_{len(CALLS)}", "status": "requires_capture"}, "tool": tool}
    if tool == "payment_intents.capture":
        return {"ok": True, "data": {"status": "succeeded"}, "tool": tool}
    if tool in ("payment_intents.cancel", "refunds.create"):
        return {"ok": True, "data": {"id": "x", "status": "canceled"}, "tool": tool}
    return {"ok": True, "data": {}, "tool": tool}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(firedrill, "call", fake_call)
    monkeypatch.setattr(firedrill, "post", lambda text: {"ok": True})
    monkeypatch.setattr(firedrill, "send_receipt", lambda s, b: {"ok": True, "id": "m1", "tool": "gmail"})
    CALLS.clear()
    grocery.reset_run()
    grocery.add_request("shivay", "We need laundry detergent, fragrance-free")
    grocery.add_request("dad", "we need laundry detergent")
    grocery.add_request("shivay", "1 gallon of milk for me")
    grocery.add_request("dad", "1 gallon of milk for me")
    grocery.add_request("dad", "2 bread for me")
    yield


def test_attribution_kept():
    reqs = grocery.active_requests("run-1")
    assert {r["author"] for r in reqs} == {"shivay", "dad"}
    assert all(r["source_text"] for r in reqs)


def test_shared_merges_personal_allocates():
    lines, _ = grocery.consolidate("run-1")
    det = next(l for l in lines if l["item"] == "laundry detergent")
    milk = next(l for l in lines if l["item"] == "milk")
    assert det["allocation"] == "shared" and det["quantity"] == 1 and len(det["requests"]) == 2
    assert milk["allocation"] == "personal" and milk["per_member"] == {"shivay": 1, "dad": 1}


def test_plan_respects_hard_constraint_and_coverage():
    p = grocery.plan("shivay")
    best = next(q for q in p["quotes"] if q["source_key"] == p["recommended"])
    det = next(i for i in best["items"] if i["item"] == "laundry detergent")
    assert "fragrance-free" in det["offer"]["attributes"]
    costco = next(q for q in p["quotes"] if q["retailer"] == "Costco")
    assert not costco["feasible"] and costco["missing"]  # bread out of stock: partial basket is not "cheaper"
    ralphs = next(q for q in p["quotes"] if q["retailer"] == "Ralphs")
    assert not ralphs["feasible"]
    assert best["unknown"]  # unknown costs are labelled, not zero


@pytest.mark.parametrize("mode", ["group_payer", "individual_shares"])
def test_allocations_reconcile_exactly(mode):
    grocery.set_payment_mode("shivay", mode, "shivay")
    p = grocery.plan("shivay")
    best = next(q for q in p["quotes"] if q["source_key"] == p["recommended"])
    assert sum(Decimal(a["amount"]) for a in p["allocations"]) == Decimal(best["total"])


def test_preference_reason_stays_private():
    grocery.set_preference("dad", "laundry detergent", "fragrance-free", True, "group", private_reason="skin condition")
    mine = grocery.prefs_for("dad", include_private_reason=True)
    theirs = grocery.prefs_for("shivay", include_private_reason=True)
    assert any(p.get("private_reason") for p in mine)
    assert not any(p.get("private_reason") for p in theirs)


def test_changed_plan_needs_new_approval():
    p = grocery.plan("shivay")
    grocery.add_request("dad", "bananas for me")
    with pytest.raises(PermissionError):
        grocery.approve("shivay", p["id"], "999")


def test_individual_shares_full_flow_idempotent_and_refund():
    grocery.set_payment_mode("shivay", "individual_shares")
    p = grocery.plan("shivay")
    with pytest.raises(PermissionError):
        grocery.execute("shivay")  # approvals missing
    for a in p["allocations"]:
        grocery.approve(a["member"], p["id"], a["amount"])
    act = grocery.execute("shivay")
    assert act["state"] == "order_placed_synthetic"
    assert "synthetic" in act["order"]["status"]
    n = len(CALLS)
    again = grocery.execute("shivay")  # duplicate request
    assert again["attempt"] == act["attempt"] and len(CALLS) == n
    r = grocery.refund("shivay")
    assert all(pay["state"] == "refunded" for pay in r["payments"])


def test_declined_card_releases_others_and_pauses():
    grocery.set_payment_mode("shivay", "individual_shares")
    p = grocery.plan("shivay")
    for a in p["allocations"]:
        grocery.approve(a["member"], p["id"], a["amount"])
    act = grocery.execute("shivay", decline_card_for="dad")
    assert act["state"] == "payment_failed"
    assert grocery.get_run()["state"] == "paused"
    assert not any(pay["state"] in ("authorized", "captured") for pay in act["payments"])


def test_outsider_cannot_read_or_approve():
    p = grocery.plan("shivay")
    with pytest.raises(PermissionError):
        grocery.snapshot("mallory")
    with pytest.raises(PermissionError):
        grocery.approve("mallory", p["id"], "999")
