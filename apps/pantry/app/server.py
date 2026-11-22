"""HTTP API + web app + Poppy store + background trigger loop.

Run: uvicorn app.server:app --host 0.0.0.0 --port 8700
"""
import asyncio
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from . import agent, chat, memory, persona, store, telemetry
from .config import TODAY, integrations
from .db import db
from .seed import MEMBERS

app = FastAPI(title="Occasions")
WEB = Path(__file__).resolve().parent.parent / "web"
SCAN_EVERY = int(os.environ.get("SCAN_EVERY_SECONDS", "0"))  # 0 = only on demand (demo control)


def _member(m):
    if m not in MEMBERS:
        raise HTTPException(404, "unknown member")
    return m


@app.on_event("startup")
async def startup():
    if not db.list("memory"):
        agent.reset()

    def setup_sponsors():  # one-time: load verified facts into Senso, family facts into Cognee
        from . import senso
        try:
            print("senso kb docs created:", senso.sync_kb())
            print("cognee facts seeded:", memory.seed_cognee())
            from . import grocery as _g
            print("senso grocery docs created:", _g.sync_grocery_kb())
        except Exception as e:
            print("sponsor setup failed:", type(e).__name__)
    asyncio.get_event_loop().run_in_executor(None, setup_sponsors)
    if SCAN_EVERY > 0:
        async def loop():
            while True:
                await asyncio.to_thread(agent.scan_calendar)
                await asyncio.sleep(SCAN_EVERY)
        asyncio.create_task(loop())


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


@app.get("/api/state")
def state(member: str = "shivay"):
    _member(member)
    return {"today": TODAY.isoformat(), "member": member, "members": MEMBERS,
            "verified": persona.status(member), "occasions": agent.list_occasions(),
            "integrations": integrations(), "settings": telemetry.settings(member)}


@app.post("/api/scan")
def scan():
    """The Firedrill calendar tick. Runs on a timer when SCAN_EVERY_SECONDS > 0."""
    return {"ran": agent.scan_calendar(), "occasions": agent.list_occasions()}


@app.post("/api/occasions/{oid}/run")
def run_now(oid: str, member: str = "shivay"):
    if not agent.get_occasion(oid):
        raise HTTPException(404)
    return agent.run(oid, _member(member), trigger=f"run now by {member}")


@app.post("/api/occasions/{oid}/approve")
def approve(oid: str, member: str = "shivay"):
    return agent.approve(oid, _member(member))


@app.get("/api/occasions/{oid}")
def occasion(oid: str, member: str = "shivay"):
    o = agent.get_occasion(oid)
    if not o:
        raise HTTPException(404)
    # Receipts never leak another member's private facts to whoever is viewing.
    o["knew"] = [k for k in o.get("knew", []) if memory.can_read(_member(member), k["dataset"])]
    return o


@app.post("/api/verify")
def verify(member: str = "shivay"):
    return persona.start(_member(member))


@app.get("/api/memory")
def mem(member: str = "shivay"):
    v = memory.visible_to(_member(member))
    v["access_log"] = [a for a in memory.access_log()][-30:]
    return v


@app.post("/api/chat")
async def post_chat(req: Request, member: str = "shivay"):
    body = await req.json()
    return {"reply": chat.handle(_member(member), body.get("text", "")), "history": chat.history(member)}


@app.get("/api/chat")
def get_chat(member: str = "shivay"):
    return chat.history(_member(member))


@app.get("/api/events")
def events():
    return telemetry.recent_events()


@app.post("/api/reset")
def reset():
    agent.reset()
    return {"ok": True}


# ---- Group grocery run (PRD) ----
from . import grocery  # noqa: E402


def _g(fn, *a, **k):
    try:
        return fn(*a, **k)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/group")
def group_page():
    return FileResponse(WEB / "group.html")


@app.get("/api/g/snapshot")
def g_snapshot(member: str = "shivay"):
    return _g(grocery.snapshot, member)


@app.post("/api/g/requests")
async def g_add(req: Request, member: str = "shivay"):
    b = await req.json()
    return await asyncio.to_thread(_g, grocery.add_request, member, b.get("text", ""), b.get("audience", "group"))


@app.patch("/api/g/requests/{rid}")
async def g_update(rid: str, req: Request, member: str = "shivay"):
    return await asyncio.to_thread(_g, grocery.update_request, member, rid, await req.json())


@app.post("/api/g/prefs")
async def g_pref(req: Request, member: str = "shivay"):
    b = await req.json()
    return await asyncio.to_thread(_g, grocery.set_preference, member, b["subject"], b["value"], b.get("hard", True),
              b.get("visibility", "group"), b.get("private_reason"), b.get("expires"))


@app.post("/api/g/mode")
async def g_mode(req: Request, member: str = "shivay"):
    b = await req.json()
    return await asyncio.to_thread(_g, grocery.set_payment_mode, member, b["mode"], b.get("payer"))


@app.post("/api/g/plan")
def g_plan(member: str = "shivay"):
    return _g(grocery.plan, member)


@app.post("/api/g/approve")
async def g_approve(req: Request, member: str = "shivay"):
    b = await req.json()
    return await asyncio.to_thread(_g, grocery.approve, member, b["plan_id"], b["limit"])


@app.post("/api/g/decline")
async def g_decline(req: Request, member: str = "shivay"):
    b = await req.json()
    return await asyncio.to_thread(_g, grocery.decline, member, b["plan_id"])


@app.post("/api/g/execute")
def g_execute(member: str = "shivay", test_decline_for: str | None = None):
    return _g(grocery.execute, member, test_decline_for)


@app.post("/api/g/refund")
def g_refund(member: str = "shivay"):
    return _g(grocery.refund, member)


@app.post("/api/g/reset")
def g_reset(fresh: int = 0):
    grocery.reset_run(fresh=bool(fresh))
    return {"ok": True, "fresh": bool(fresh)}


@app.post("/api/g/household")
async def g_household(req: Request, member: str = "ann"):
    b = await req.json()
    return await asyncio.to_thread(_g, grocery.create_household, member, b.get("name") or "Maple House", b.get("address"), b.get("zip"),
              b.get("how_often"), b.get("requests_close"), b.get("window"), b.get("payment_mode"))


@app.post("/api/g/invite")
async def g_invite(req: Request, member: str = "ann"):
    b = await req.json()
    return await asyncio.to_thread(_g, grocery.invite, member, b.get("name", ""), b.get("email", ""))


@app.post("/api/g/join")
async def g_join(req: Request):
    b = await req.json()
    r = await asyncio.to_thread(_g, grocery.join, b.get("code", ""))
    mcp_base = os.environ.get("PUBLIC_MCP_URL", "")
    r["mcp_url"] = f"{mcp_base.rstrip('/')}/mcp?token={r['mcp_token']}" if mcp_base else None
    return r


@app.get("/api/g/profile")
def g_profile_get(member: str = "ann"):
    return _g(grocery.get_profile, member)


@app.post("/api/g/profile")
async def g_profile_set(req: Request, member: str = "ann"):
    b = await req.json()
    return await asyncio.to_thread(_g, grocery.set_profile, member, b.get("allergies"), b.get("diet"), b.get("always_get"),
              b.get("share_with_group", True))


@app.get("/api/g/chat")
def g_chat_history(member: str = "ann"):
    from . import gchat
    return _g(gchat.history, member)


@app.post("/api/g/chat")
async def g_chat(req: Request, member: str = "ann"):
    from . import gchat
    b = await req.json()
    return await asyncio.to_thread(_g, gchat.handle, member, b.get("text", ""))


@app.post("/api/g/lastcall")
async def g_lastcall(req: Request, member: str = "ann"):
    b = await req.json() if (await req.body()) else {}
    return await asyncio.to_thread(_g, grocery.start_last_call, member, b.get("minutes", 2))


@app.post("/api/g/done")
def g_done(member: str = "ann"):
    return _g(grocery.mark_done, member)


@app.on_event("startup")
async def cutoff_loop():
    async def loop():
        while True:
            try:
                await asyncio.to_thread(grocery.check_cutoff)
            except Exception as e:
                print("cutoff check failed:", type(e).__name__, str(e)[:120])
            await asyncio.sleep(4)
    asyncio.create_task(loop())


# ---- Demo Market (Poppy) ----
@app.get("/.well-known/poppy.json")
def poppy():
    return store.discovery()


@app.get("/store/catalog")
def store_catalog(slot: str | None = None):
    return [{k: v for k, v in c.items() if k != "claims"} | {"claims": [x["text"] for x in c["claims"]]}
            for c in store.catalog(slot)]


@app.post("/store/orders")
async def store_order(req: Request):
    body = await req.json()
    res = store.place_order({k: req.headers.get(k, "") for k in
                             ("Poppy-Session", "Poppy-User", "Poppy-Speaker", "Poppy-Signature")}, body)
    return JSONResponse(res, status_code=200 if res.get("ok") else 401)
