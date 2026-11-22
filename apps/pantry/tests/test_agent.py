"""Rules the agent must never break. These are also the Tokens& regression checks."""
import os
import tempfile

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["OCCASIONS_NO_DOTENV"] = "1"  # tests run offline against the fixtures
for k in ("SINGLESTORE_URL", "LLM_API_KEY", "ARCEE_API_KEY", "SENSO_API_KEY", "PERSONA_API_KEY",
          "STATSIG_SERVER_SECRET", "AMPLITUDE_API_KEY", "STRIPE_SECRET_KEY", "COGNEE_API_KEY"):
    os.environ.pop(k, None)

import pytest  # noqa: E402

from app import agent, chat, memory, persona  # noqa: E402
from app.db import db  # noqa: E402


@pytest.fixture(autouse=True)
def fresh():
    agent.reset()
    persona.start("shivay")
    persona.start("dad")
    agent.scan_calendar()
    yield


def rows(oid, slot):
    return {r["id"]: r for r in agent.get_occasion(oid)["results"][slot]["checked"]}


def test_birthday_bought_without_human():
    o = agent.get_occasion("ev-mom-bday")
    assert o["status"] == "bought"
    assert o["results"]["gift"]["chosen"]["id"] == "L1"  # pottery set: she loves pottery


def test_never_buys_wool_for_mom():
    assert rows("ev-mom-bday", "gift")["L4"]["decision"] == "rejected"
    assert "wool" in rows("ev-mom-bday", "gift")["L4"]["reason"]


def test_rejects_prompt_injection():
    r = rows("ev-mom-bday", "gift")["L5"]
    assert r["decision"] == "rejected" and r.get("flag") == "injection"


def test_rejects_false_shipping_claim():
    r = rows("ev-mom-bday", "gift")["L3"]
    assert r["decision"] == "rejected" and "false claim" in r["reason"]


def test_rejects_counterfeit_seller():
    assert "not an authorized" in rows("ev-mom-bday", "gift")["L7"]["reason"]


def test_skips_what_she_already_owns():
    assert rows("ev-mom-bday", "gift")["L6"]["decision"] == "rejected"


def test_never_exceeds_mandate():
    assert rows("ev-mom-bday", "gift")["L8"]["decision"] == "over_budget"
    for o in db.list("orders"):
        if o.get("order_id"):
            assert o["price"] <= 150


def test_dinner_respects_guests():
    r = rows("ev-dinner", "main")
    assert r["G1"]["decision"] == "rejected"  # shellfish allergy
    assert r["G3"]["decision"] == "rejected"  # claims serves 6, label says 4
    assert agent.get_occasion("ev-dinner")["results"]["main"]["chosen"]["id"] == "G2"
    assert rows("ev-dinner", "dessert")["G5"]["decision"] == "rejected"  # gelatin, not vegetarian


def test_no_double_buy_across_family():
    o = agent.run("ev-mom-bday", "dad", trigger="dad's agent")
    assert o["status"] == "covered"


def test_private_memory_stays_private():
    seen = [f["fact"] for f in memory.recall("dad", "Mom")]
    assert not any("surprise" in f for f in seen)
    assert any("surprise" in f["fact"] for f in memory.recall("shivay", "Mom"))


def test_unverified_member_cannot_buy():
    db.delete("claims", "verified:dad")
    o = agent.delegate("dad", "Flowers for Mom", "Mom", "2026-11-24", "flowers", "gift")
    assert o["status"] == "needs_you" and o["needs"]["type"] == "verify"


def test_over_budget_asks_once_then_buys():
    o = agent.run("ev-camping", "shivay", trigger="test")
    assert o["status"] == "needs_you" and o["needs"]["listing_id"] == "T1"
    o = agent.approve("ev-camping", "shivay")
    assert o["status"] == "bought"


def test_chat_teaches_and_delegates():
    assert "Saved" in chat.handle("shivay", "Mom is into watercolor now")
    assert any("watercolor" in f["fact"] for f in memory.recall("dad", "Mom"))
    reply = chat.handle("dad", "get flowers for Mom")
    assert "Spring tulip bouquet" in reply  # roses are over Dad's $60 limit
