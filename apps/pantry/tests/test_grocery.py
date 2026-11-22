"""Acceptance checks for the Maple House grocery run (Ann's demo script), offline: rule extraction,
fixture snapshot prices, fake Firedrill Stripe."""
import os
import tempfile
import time
from decimal import Decimal

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "g.db")
os.environ["OCCASIONS_NO_DOTENV"] = "1"
for k in ("NEBIUS_API_KEY", "COGNEE_API_KEY", "SINGLESTORE_URL", "AMPLITUDE_API_KEY", "STATSIG_SERVER_SECRET",
          "SENSO_API_KEY", "SIE_API_KEY", "GUILD_API_KEY", "TOKENS_OBSERVE_API_KEY"):
    os.environ.pop(k, None)

import pytest  # noqa: E402

from app import firedrill, gchat, grocery  # noqa: E402

CALLS = []


def fake_call(app, tool, args, timeout=60):
    CALLS.append((app, tool, args))
    if tool == "payment_intents.create":
        if args["payment_method"] == "pm_card_chargeDeclined":
            return {"ok": False, "data": {"error": {"message": "Your card was declined."}}, "tool": tool}
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
    monkeypatch.setattr(firedrill, "send_invite", lambda to, s, b: {"ok": True, "id": "i1", "tool": "gmail"})
    CALLS.clear()
    grocery.reset_run()
    yield


def say(member, text):
    return gchat.handle(member, text)["reply"]


def ann_scene():
    grocery.set_profile("ann", ["dairy"], ["gluten-free"], ["Unsweetened oat milk"], True)
    r = [say("ann", "We need milk.")]
    r.append(say("ann", "Oatly. One carton, just for me."))
    r.append(say("ann", "Saturday's run is fine."))
    r.append(say("ann", "And bread. The Canyon Bakehouse white one."))
    r.append(say("ann", "Yes."))
    r.append(say("ann", "Also a dozen eggs for the house. Vital Farms, pasture-raised."))
    return r


def full_list():
    ann_scene()
    say("shivay", "Plain Greek yogurt, the big Chobani tub. Just for me.")
    say("shivay", "Non-fat.")
    say("yash", "Peet's Major Dickason's, ground, the small bag. Just for me.")


def test_ann_conversation_follows_script():
    r = ann_scene()
    assert r[0] == "Unsweetened oat milk, like always. Any brand?"
    assert r[1] == "When do you need it?"
    assert r[2].startswith("Added to Saturday's run: 1 carton Oatly Unsweetened Oatmilk") and "just for you" in r[2]
    assert "gluten-free" in r[3] and r[3].endswith("1 loaf, just for you, for Saturday?")
    assert r[4].startswith("Added to Saturday's run: 1 loaf Canyon Bakehouse")
    assert "shared by all 4" in r[5]


def test_shivay_and_yash():
    ann_scene()
    assert say("shivay", "Plain Greek yogurt, the big Chobani tub. Just for me.") == "Non-fat or whole milk?"
    assert "Chobani Non-Fat Plain Greek Yogurt" in say("shivay", "Non-fat.")
    reply = say("yash", "Peet's Major Dickason's, ground, the small bag. Just for me.")
    assert reply.startswith("Added") and "Peet's" in reply  # no follow-up: nothing missing, timing reused


def test_plan_best_store_and_unknowns():
    full_list()
    p = grocery.plan("ann")
    assert p["recommended"] == "walmart"
    q = {x["source_key"]: x for x in p["quotes"]}
    assert q["walmart"]["covered"] == "5 of 5" and q["walmart"]["total"] == "35.80"
    assert any("delivery fee" in u for u in q["walmart"]["unknown"])  # never shown as zero
    assert not q["target"]["feasible"] and not q["safeway"]["feasible"] and not q["wholefoods"]["feasible"]


def test_dairy_allergy_does_not_block_shivays_yogurt():
    full_list()
    p = grocery.plan("ann")
    best = next(x for x in p["quotes"] if x["source_key"] == p["recommended"])
    assert any(i["item"] == "greek yogurt" for i in best["items"])


def test_worked_example_shares():
    full_list()
    grocery.set_payment_mode("ann", "individual_shares")
    p = grocery.plan("ann")
    shares = {a["member"]: a["amount"] for a in p["allocations"]}
    assert shares == {"ann": "13.35", "shivay": "7.61", "yash": "13.20", "shane": "1.64"}
    assert sum(Decimal(v) for v in shares.values()) == Decimal("35.80")


def test_four_approvals_before_any_order():
    full_list()
    grocery.set_payment_mode("ann", "individual_shares")
    p = grocery.plan("ann")
    for m in ("ann", "shivay", "yash"):
        grocery.approve(m, p["id"], next(a["amount"] for a in p["allocations"] if a["member"] == m))
        with pytest.raises(PermissionError):
            grocery.execute("ann")
    grocery.approve("shane", p["id"], next(a["amount"] for a in p["allocations"] if a["member"] == "shane"))
    act = grocery.execute("ann")
    assert act["state"] == "order_placed_synthetic" and len(act["payments"]) == 4
    n = len(CALLS)
    assert grocery.execute("ann")["attempt"] == act["attempt"] and len(CALLS) == n  # no duplicate order
    assert all(x["state"] == "refunded" for x in grocery.refund("ann")["payments"])


def test_declined_card_releases_others():
    full_list()
    grocery.set_payment_mode("ann", "individual_shares")
    p = grocery.plan("ann")
    for a in p["allocations"]:
        grocery.approve(a["member"], p["id"], a["amount"])
    act = grocery.execute("ann", decline_card_for="yash")
    assert act["state"] == "payment_failed" and grocery.get_run()["state"] == "paused"
    assert not any(x["state"] in ("authorized", "captured") for x in act["payments"])


def test_last_call_runs_without_shane():
    full_list()
    grocery.start_last_call("ann", minutes=0.001)
    for m in ("ann", "shivay", "yash"):
        grocery.mark_done(m)
    time.sleep(0.2)
    p = grocery.check_cutoff()
    assert p and p["recommended"] == "walmart"
    assert any("without waiting for Shane" in a["decision"] for a in grocery.snapshot("ann")["audit"])


def test_changed_plan_needs_new_approval():
    full_list()
    p = grocery.plan("ann")
    say("shane", "a dozen eggs for the house")
    with pytest.raises(PermissionError):
        grocery.approve("ann", p["id"], "999")


def test_profile_privacy_and_outsiders():
    grocery.set_profile("ann", ["dairy"], ["gluten-free"], [], share_with_group=False)
    seen = grocery.snapshot("shivay")["profiles"]
    assert "ann" not in seen  # not shared, so Shivay sees nothing of Ann's profile
    with pytest.raises(PermissionError):
        grocery.snapshot("mallory")


def test_create_invite_join_flow():
    grocery.reset_run(fresh=True)
    grocery.create_household("ann", "Maple House", payment_mode="individual_shares")
    inv = grocery.invite("ann", "Shivay", "shivay@example.test")
    assert inv["status"] == "invited" and "join=" in inv["join_link"] and inv["email_sent"]
    with pytest.raises(PermissionError):
        grocery.snapshot(inv["member"])  # invited, not joined yet
    with pytest.raises(PermissionError):
        grocery.invite("shivay", "Mallory", "m@example.test")
    code = inv["join_link"].split("join=")[1]
    j = grocery.join(code)
    assert j["member"] == "shivay" and j["mcp_token"]
    assert grocery.member_for_token(j["mcp_token"]) == "shivay"
    assert grocery.snapshot("shivay")["group"]["members"]["shivay"]["status"] == "joined"
    with pytest.raises(PermissionError):
        grocery.join(code)  # single use


def test_split_basket_reported_honestly():
    full_list()
    p = grocery.plan("ann")
    assert p["split"]["possible"] and p["split"]["note"].startswith("One store had the lowest price on all 5")
