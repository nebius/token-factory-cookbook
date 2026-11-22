"""MCP server: lets each family member's own agent (Claude, ChatGPT, ...) use the family layer.

Identity comes from the bearer token (MEMBER_TOKENS="shivay:<token>,dad:<token>") over HTTP, or
OCCASIONS_MEMBER for a local stdio connection. The server enforces what each member can read and
spend; the calling model never decides that.

Run (HTTP): python -m app.mcp_server            -> http://0.0.0.0:8701/mcp
Run (stdio): OCCASIONS_MEMBER=dad python -m app.mcp_server stdio
"""
import os
import sys

from mcp.server.fastmcp import Context, FastMCP

from . import agent, memory
from .seed import MEMBERS

mcp = FastMCP("occasions-family", host="0.0.0.0", port=int(os.environ.get("MCP_PORT", "8701")))


def _tokens():
    out = {}
    for pair in os.environ.get("MEMBER_TOKENS", "").split(","):
        if ":" in pair:
            m, t = pair.split(":", 1)
            out[t.strip()] = m.strip()
    return out


def _member(ctx: Context) -> str:
    try:
        req = ctx.request_context.request
        auth = req.headers.get("authorization", "") if req is not None else ""
        if not auth and req is not None and req.query_params.get("token"):
            auth = "Bearer " + req.query_params["token"]  # connector UIs that only accept a URL
    except Exception:
        auth = ""
    if auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
        m = _tokens().get(tok)
        if not m:  # members who joined through an invite link get a personal token stored with the household
            from . import grocery
            m = grocery.member_for_token(tok)
        if m:
            return m
        raise PermissionError("unknown token")
    m = os.environ.get("OCCASIONS_MEMBER")
    if m in MEMBERS:
        return m
    raise PermissionError("no member identity")


def _brief(o):
    return {"id": o["id"], "title": o["title"], "date": o["date"], "status": o["status"],
            "person": o.get("person"), "needs": o.get("needs", {}).get("text"),
            "bought": [r["order"]["item"] for r in o.get("results", {}).values() if r.get("order")]}


@mcp.tool()
def upcoming_occasions(ctx: Context) -> list:
    """Family occasions coming up, and what has already been handled (and by whose agent)."""
    _member(ctx)
    from .db import db
    out = []
    for o in agent.list_occasions():
        b = _brief(o)
        c = db.get("claims", f"claim:{o['id']}")
        b["handled_by"] = MEMBERS[c["member"]]["name"] if c else None
        out.append(b)
    return out


@mcp.tool()
def recall(person: str, ctx: Context) -> list:
    """What the family knows about a person (likes, allergies, what they own). Only facts you may see."""
    m = _member(ctx)
    return [{"fact": f["fact"], "source": f["source"], "shared": f["dataset"] == "household"}
            for f in memory.recall(m, person, purpose="asked by member's own agent (MCP)")]


@mcp.tool()
def remember(person: str, fact: str, ctx: Context, share_with_family: bool = False) -> dict:
    """Save a fact. Private to you unless share_with_family is true."""
    m = _member(ctx)
    f = memory.remember(m, person, fact, scope="household" if share_with_family else "private",
                        source=f"{MEMBERS[m]['name']}'s agent (MCP)")
    return {"saved": True, "visible_to": "whole family" if share_with_family else "only you"}


@mcp.tool()
def plan_and_buy(what: str, person: str, by_date: str, ctx: Context) -> dict:
    """Have the family agent find, fact-check and buy something (e.g. 'flowers') within your own mandate.
    by_date is YYYY-MM-DD. Returns what it bought, or what needs your approval."""
    m = _member(ctx)
    from .seed import CATALOG
    slot = next((s for c in CATALOG for s in c["slot_tags"] if s.rstrip("s") in what.lower()), None)
    if not slot:
        return {"error": f"no connected store sells '{what}' yet"}
    o = agent.delegate(m, f"{what.capitalize()} for {person}", person, by_date, slot, "gift")
    b = _brief(o)
    b["rejected"] = [{"item": r["title"], "why": r["reason"]} for res in o["results"].values()
                     for r in res.get("checked", []) if r["decision"] != "ok"]
    b["receipt"] = f"/#/receipt/{o['id']}"
    return b


@mcp.tool()
def receipt(occasion_id: str, ctx: Context) -> dict:
    """The audit trail for an occasion: what the agent knew, checked and did."""
    _member(ctx)
    o = agent.get_occasion(occasion_id)
    if not o:
        return {"error": "not found"}
    return {"title": o["title"], "status": o["status"], "steps": o["steps"]}


# ---------- Group grocery run (PRD tools). Identity comes from the token; the model never supplies it. ----------
from . import grocery  # noqa: E402


@mcp.tool()
def get_group_context(ctx: Context) -> dict:
    """The group's members, delivery ZIP, payment mode and the preferences you are allowed to see."""
    m = _member(ctx)
    s = grocery.snapshot(m)
    return {"group": s["group"], "run": {k: s["run"][k] for k in ("id", "state", "version", "payment_mode", "deadline")},
            "preferences": [{k: p[k] for k in ("member", "subject", "value", "hard", "visibility")} for p in s["preferences"]]}


@mcp.tool()
def add_request(text: str, ctx: Context) -> dict:
    """Add a grocery need in plain words, e.g. 'we need fragrance-free detergent' or '1 gallon of milk for me'."""
    r = grocery.add_request(_member(ctx), text)
    return {k: r.get(k) for k in ("id", "item", "quantity", "unit", "allocation", "constraints", "status")}


@mcp.tool()
def update_request(request_id: str, ctx: Context, status: str = "", quantity: float = 0) -> dict:
    """Change or cancel (status='cancelled') one of your own requests."""
    ch = {}
    if status:
        ch["status"] = status
    if quantity:
        ch["quantity"] = quantity
    r = grocery.update_request(_member(ctx), request_id, ch)
    return {k: r.get(k) for k in ("id", "item", "quantity", "status", "version")}


@mcp.tool()
def set_preference(subject: str, value: str, ctx: Context, hard: bool = True, share_with_group: bool = True) -> dict:
    """Remember a grocery preference (e.g. detergent -> fragrance-free). Reasons are never shared."""
    p = grocery.set_preference(_member(ctx), subject, value, hard, "group" if share_with_group else "private")
    return {k: p[k] for k in ("id", "subject", "value", "hard", "visibility")}


@mcp.tool()
def get_run_snapshot(ctx: Context) -> dict:
    """Current requests, plan summary, approvals and order state for this run."""
    s = grocery.snapshot(_member(ctx))
    p = s["plan"]
    return {"run": s["run"], "requests": [{k: r.get(k) for k in ("id", "author", "item", "quantity", "unit", "allocation", "status")}
                                          for r in s["requests"]],
            "plan": p and {"id": p["id"], "recommended": p["recommended"], "why": p["why"],
                           "allocations": p["allocations"], "questions": p["questions"]},
            "approvals": s["approvals"], "execution": s["execution"] and {"state": s["execution"]["state"],
                                                                          "order": s["execution"].get("order")}}


@mcp.tool()
def save_plan(ctx: Context) -> dict:
    """Have the agent compare baskets across the sources checked and save a new plan version.
    Approving and paying are human-only actions in the app; this tool cannot approve."""
    p = grocery.plan(_member(ctx))
    return {"id": p["id"], "recommended": p["recommended"], "why": p["why"], "allocations": p["allocations"]}


@mcp.tool()
def talk_to_pantry(message: str, ctx: Context) -> dict:
    """Talk to the household grocery agent in plain words ("We need milk", "Oatly, one carton, just for me").
    It asks one follow-up question at a time when something is missing, uses your saved profile, and adds the item."""
    from . import gchat
    r = gchat.handle(_member(ctx), message)
    return {"reply": r["reply"], "tags": r["tags"], "added": bool(r.get("added"))}


@mcp.tool()
def set_profile(ctx: Context, allergies: list[str] | None = None, diet: list[str] | None = None,
                always_get: list[str] | None = None, share_with_household: bool = True) -> dict:
    """Save your grocery profile: allergies (e.g. dairy), diet (e.g. gluten-free), things you always get."""
    p = grocery.set_profile(_member(ctx), allergies, diet, always_get, share_with_household)
    return {"rules": grocery.profile_constraints(p["member"]), "always_get": p["always_get"], "shared": p["share_with_group"]}


@mcp.tool()
def append_audit_event(decision: str, ctx: Context) -> dict:
    """Record a note in the run's audit trail, attributed to your agent."""
    m = _member(ctx)
    return grocery.audit(grocery.get_run()["id"], f"{grocery.member_name(m)}'s agent", decision[:300], action="note")


if __name__ == "__main__":
    mcp.run("stdio" if "stdio" in sys.argv else "streamable-http")
