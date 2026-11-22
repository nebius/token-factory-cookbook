"""The agent loop: trigger -> recall -> read listings -> check -> choose -> claim -> buy -> receipt.

Every step appends to the occasion's trail with its source, so the receipt page can show
what the agent knew, what it checked, and what it did.
"""
import re
import time
import uuid
from datetime import date, timedelta

from . import firedrill, memory, models, persona, senso, store, telemetry
from .config import PUBLIC_BASE_URL as PUBLIC_RECEIPT_URL
from .config import TODAY
from .db import db
from .seed import CALENDAR, MEMBERS


def _now():
    return time.strftime("%H:%M:%S")


def days_until(iso):
    return (date.fromisoformat(iso) - TODAY).days


# ---------- occasions ----------

def get_occasion(oid):
    return db.get("occasions", oid)


def save(occ):
    db.put("occasions", occ["id"], occ, grp=occ["owner"], seq=days_until(occ["date"]))


def list_occasions():
    return sorted(db.list("occasions"), key=lambda o: o["date"])


def calendar_events():
    """Read occasions from the Firedrill Google Calendar (falls back to the seed calendar)."""
    if not firedrill.live("calendar"):
        return CALENDAR, "seed calendar (demo fixture)"
    firedrill.ensure_events(CALENDAR)
    items = firedrill.list_events(f"{TODAY.isoformat()}T00:00:00Z", f"{(TODAY + timedelta(days=45)).isoformat()}T00:00:00Z")
    by_id = {e["id"]: e for e in CALENDAR}
    out = []
    for it in items:
        desc, title = it.get("description") or "", it.get("summary") or ""
        start = (it.get("start") or {}).get("date") or ((it.get("start") or {}).get("dateTime") or "")[:10]
        if firedrill.TAG in desc:
            sid = desc.split(firedrill.TAG)[-1].split()[0]
            if sid in by_id:
                out.append({**by_id[sid], "date": start or by_id[sid]["date"], "calendar_event_id": it.get("id")})
                continue
        m = re.match(r"(.+?)'s birthday", title, re.I)
        if m:  # any birthday someone adds to the calendar becomes a gift occasion
            out.append({"id": f"cal-{it.get('id')}", "title": title, "date": start, "kind": "birthday",
                        "person": m.group(1).strip(), "owner": "shivay", "calendar_event_id": it.get("id"),
                        "slots": [{"slot": "gift", "category": "gift", "query": f"gift for {m.group(1)}"}]})
    return out, f"Firedrill Google Calendar (events.list, {len(items)} events read)"


def scan_calendar():
    """Creates occasions for calendar events and runs the agent for those now due."""
    ran = []
    events, source = calendar_events()
    for ev in events:
        occ = get_occasion(ev["id"])
        if not occ:
            occ = {**ev, "status": "too_early", "steps": [], "results": {}, "created_by": "calendar",
                   "calendar_source": source}
            save(occ)
        st = telemetry.settings(occ["owner"])
        due = days_until(occ["date"]) <= st.get("act_days_before", MEMBERS[occ["owner"]]["act_days_before"])
        if due and occ["status"] in ("too_early",):
            telemetry.track("trigger_detected", occ["owner"], {"occasion": occ["id"], "source": "calendar"})
            run(occ["id"], occ["owner"], trigger="calendar event")
            ran.append(occ["id"])
    return ran


def delegate(member, title, person, date_iso, slot, category):
    """A member (or their own agent over MCP) hands over a new occasion."""
    oid = f"ev-{uuid.uuid4().hex[:6]}"
    occ = {"id": oid, "title": title, "date": date_iso, "kind": "delegated", "person": person, "owner": member,
           "slots": [{"slot": slot, "category": category, "query": title}], "status": "planning", "steps": [],
           "results": {}, "created_by": member}
    save(occ)
    return run(oid, member, trigger=f"delegated by {member}")


# ---------- constraints from memory ----------

def constraints(facts):
    text = " | ".join(f["fact"] for f in facts).lower()
    c = {"avoid_materials": set(), "avoid_allergens": set(), "owns": set(), "vegetarian": False}
    for m in re.finditer(r"allergic to (\w+)", text):
        c["avoid_materials"].add(m.group(1)); c["avoid_allergens"].add(m.group(1))
    for m in re.finditer(r"(\w+) allergy", text):
        c["avoid_allergens"].add(m.group(1))
    for m in re.finditer(r"already owns ([a-z ]+)", text):
        c["owns"].add(m.group(1).split()[-1])  # the noun: "gardening gloves" -> "gloves"
    if "vegetarian" in text:
        c["vegetarian"] = True
    return c


# ---------- the loop ----------

def run(oid, member, trigger="manual"):
    occ = get_occasion(oid)
    steps = occ["steps"] = []
    add = lambda kind, text, source="", sponsor="": steps.append(
        {"t": _now(), "kind": kind, "text": text, "source": source, "sponsor": sponsor})

    add("trigger", f"Started by {trigger}: {occ['title']} on {occ['date']} ({days_until(occ['date'])} days away)",
        occ.get("calendar_source", trigger), "Firedrill")

    # Someone else already handling it?
    claim = db.get("claims", f"claim:{oid}")
    if claim and claim["member"] != member:
        occ["status"] = "covered"
        add("claim", f"{MEMBERS[claim['member']]['name']}'s agent already claimed this. Not buying twice.",
            "household claims", "Cognee")
        save(occ)
        return occ

    # Verified human behind the mandate?
    v = persona.refresh(member)
    if not v.get("verified"):
        occ["status"] = "needs_you"
        occ["needs"] = {"type": "verify", "text": f"{MEMBERS[member]['name']} must verify with Persona before the agent can buy."}
        add("mandate", "Mandate not verified yet, stopping before any purchase.", "Persona", "Persona")
        save(occ)
        return occ
    add("mandate", f"Mandate verified ({v.get('engine')}). Limits: {MEMBERS[member]['mandate']}", "Persona", "Persona")

    # What we know (memory, permission-checked)
    people = [occ.get("person")] + occ.get("guests", [])
    facts = []
    for p in [x for x in people if x]:
        facts += memory.recall(member, p, purpose=f"plan {occ['title']}")
    facts += memory.recall(member, "Family", purpose=f"plan {occ['title']}")
    occ["knew"] = [{"about": f["about"], "fact": f["fact"], "source": f["source"], "dataset": f["dataset"]} for f in facts]
    add("memory", f"Recalled {len(facts)} structured facts about {', '.join(x for x in people if x)} "
                  f"(datasets: {', '.join(sorted({f['dataset'] for f in facts}))})", "family memory", "Cognee")
    who = ", ".join(x for x in people if x) or "the family"
    ctext, cinfo = memory.cognee_recall(member, f"What should we know about {who} when shopping for {occ['title']}? "
                                                 f"Likes, allergies, things they already own.")
    if ctext:
        occ["knew"].append({"about": who, "fact": f"Cognee: {ctext[:400]}", "source": "Cognee recall",
                            "dataset": f"{member}_private"})
        add("memory", f"Cognee recall over {', '.join(cinfo)}: \"{ctext[:220]}\"", "Cognee /api/v1/recall", "Cognee")
    else:
        add("memory", f"Cognee recall unavailable ({cinfo}); used structured memory only", "Cognee", "Cognee")
    cons = constraints(facts)
    past = [o for o in db.list("orders") if o.get("for") == occ.get("person")]

    settings = telemetry.settings(member)
    occ["status"] = "planning"
    occ["results"] = {}
    all_bought = True
    for slot in occ["slots"]:
        listings = store.catalog(slot["slot"])
        add("search", f"{slot['slot']}: found {len(listings)} listings in {store.STORE_NAME}",
            "SingleStore catalog", "SingleStore")
        add("read", f"Read {len(listings)} listings with the small model ({models.route_label()['small']})",
            "listing text", "Superlinked SIE")
        checked, safe = [], []
        need_by = days_until(occ["date"]) - 1
        for L in listings:
            row = {"id": L["id"], "title": L["title"], "price": L["price"], "seller": L["seller"],
                   "verdicts": [], "decision": "ok", "reason": ""}
            inj = models.detect_injection(L["text"])
            if inj:
                row.update(decision="rejected", reason=f"prompt injection in listing text: \"{inj}\"", flag="injection")
                telemetry.track("listing_rejected", member, {"reason": "injection", "listing": L["id"]})
                checked.append(row); continue
            bad_mat = cons["avoid_materials"] & set(m.lower() for m in L.get("materials", []))
            bad_all = cons["avoid_allergens"] & set(a.lower() for a in L.get("allergens", []))
            if bad_mat or bad_all:
                row.update(decision="rejected", reason=f"contains {', '.join(bad_mat | bad_all)} (allergy in memory)")
            elif cons["owns"] and any(w in L["title"].lower() for w in cons["owns"]):
                row.update(decision="rejected", reason="they already own this (from memory)")
            elif any(o["item"].lower() in L["title"].lower() for o in past):
                row.update(decision="rejected", reason="already given before (order history)")
            if row["decision"] == "ok":
                row["verdicts"] = senso.check_listing(L)
                bad = [x for x in row["verdicts"] if x["verdict"] == "contradicted"]
                if bad:
                    row.update(decision="rejected", reason=f"false claim: \"{bad[0]['claim']}\", {bad[0]['why']}")
                ship = next((x for x in row["verdicts"] if "ship" in x["claim"].lower() or "deliver" in x["claim"].lower()
                             or "arriv" in x["claim"].lower()), None)
                if row["decision"] == "ok" and ship:
                    m = re.search(r"(\d+) days", ship["why"])
                    if m and int(m.group(1)) > need_by:
                        row.update(decision="rejected", reason=f"won't arrive in time ({ship['why']})")
                if row["decision"] == "ok" and slot["category"] == "groceries" and cons["vegetarian"]:
                    from .seed import VERIFIED_FACTS
                    if "vegetarian" not in VERIFIED_FACTS.get(L["id"], {}).get("diet", []):
                        row.update(decision="rejected", reason="not vegetarian (a guest is vegetarian; strictest rule wins)")
                if row["decision"] == "ok" and slot["category"] == "groceries":
                    serves = next((x for x in row["verdicts"] if x["claim"].lower().startswith(("serves", "8 slices"))), None)
                    if serves and serves["verdict"] == "contradicted":
                        row.update(decision="rejected", reason=serves["why"])
            if row["decision"] == "ok":
                limit = MEMBERS[member]["mandate"][slot["category"]]
                if L["price"] > limit:
                    row.update(decision="over_budget", reason=f"${L['price']:.0f} is over your ${limit} {slot['category']} limit")
                else:
                    safe.append(L)
            if row["decision"] == "rejected":
                telemetry.track("listing_rejected", member, {"reason": row["reason"][:40], "listing": L["id"]})
            checked.append(row)
        add("check", f"Checked {len(checked)} listings: {len(safe)} safe, "
                     f"{sum(r['decision']=='rejected' for r in checked)} rejected, "
                     f"{sum(r['decision']=='over_budget' for r in checked)} over budget",
            "Senso verified facts + memory", "Senso")

        res = {"slot": slot["slot"], "checked": checked}
        if not safe:
            over = [r for r in checked if r["decision"] == "over_budget"]
            occ["status"] = "needs_you"
            all_bought = False
            if over:
                occ["needs"] = {"type": "approve", "listing_id": over[0]["id"], "slot": slot["slot"],
                                "text": f"{over[0]['title']} is ${over[0]['price']:.0f}, {over[0]['reason']}."}
            else:
                occ["needs"] = {"type": "none_safe", "text": f"No safe option for {slot['slot']}."}
            add("escalate", occ["needs"]["text"] + " Asking once.", "mandate", "Statsig")
            occ["results"][slot["slot"]] = res
            continue

        rel = models.sie_scores(" ".join(f["fact"] for f in facts if f["about"] != "Family")[:600] or occ["title"],
                                [f"{L['title']} ({', '.join(L['tags'])})" for L in safe])
        relevance = {L["id"]: s for L, s in zip(safe, rel)} if rel else None
        if relevance:
            add("rank", "Relevance to what we know: " + ", ".join(f"{L['title']} {relevance[L['id']]:.2f}" for L in safe),
                f"SIE {models.SIE_MODEL} embeddings", "Superlinked SIE")
        pick, reason, usage = models.choose([f["fact"] for f in facts], safe, occ, relevance)
        chosen = next(L for L in safe if L["id"] == pick)
        res.update(chosen={"id": chosen["id"], "title": chosen["title"], "price": chosen["price"]},
                   reason=reason, model=usage)
        add("decide", f"Chose {chosen['title']} (${chosen['price']:.2f}): {reason}",
            f"{usage['model']}" + (f", {usage.get('tokens')} tokens" if usage.get("tokens") else ""),
            "Nebius Token Factory" if usage["model"] != "local-ranker" else "")

        auto_limit = float(settings.get("auto_buy_under", MEMBERS[member]["mandate"][slot["category"]]))
        if not settings.get("auto_buy", True) or chosen["price"] > auto_limit:
            occ["status"] = "needs_you"; all_bought = False
            why = "auto-buy is off" if not settings.get("auto_buy", True) else f"above the ${auto_limit:.0f} auto-buy limit"
            occ["needs"] = {"type": "approve", "listing_id": chosen["id"], "slot": slot["slot"],
                            "text": f"Approve {chosen['title']} for ${chosen['price']:.2f}? ({why}, from Statsig agent_settings)"}
            add("escalate", occ["needs"]["text"], f"Statsig ({settings.get('_source')})", "Statsig")
            occ["results"][slot["slot"]] = res
            continue
        res["order"] = buy(occ, member, chosen["id"], add)
        occ["results"][slot["slot"]] = res
        if not res["order"].get("ok"):
            all_bought = False
            occ["status"] = "needs_you"
            occ["needs"] = {"type": "failed", "text": f"Checkout failed for {chosen['title']}; nothing was charged twice. Retry?"}
            db.delete("claims", f"claim:{occ['id']}")  # release the claim so someone else can buy

    if all_bought:
        occ["status"] = "bought"
        occ.pop("needs", None)
    save(occ)
    return occ


def buy(occ, member, listing_id, add=None):
    # Household claim first, so other members' agents don't double-buy.
    db.put("claims", f"claim:{occ['id']}", {"occasion": occ["id"], "member": member, "listing": listing_id,
                                            "at": _now()}, grp="claims")
    if add:
        add("claim", f"Claimed '{occ['title']}' in household memory so other agents won't buy it too",
            "household claims", "Cognee")
    disc = store.discovery()
    body = {"listing_id": listing_id, "occasion": occ["title"], "member_ref": member}
    headers = store.sign(member, body)
    order = store.place_order(headers, body)
    if not order.get("ok"):
        if add:
            add("buy", f"Store refused the order: {order.get('error')}", store.STORE_NAME, "Poppy")
        return order
    order.update({"for": occ.get("person"), "member": member, "occasion": occ["id"],
                  "signed": {k: (v[:12] + "…" if k == "Poppy-Signature" else v) for k, v in headers.items()},
                  "scopes": [s["name"] for s in disc["scopes"]]})
    pay = order["payment"]
    if not pay.get("ok", True) and pay.get("provider") == "firedrill-stripe":
        order["ok"] = False
        if add:
            add("buy", f"Payment failed on {pay.get('tool')}: {pay.get('status')}", "Firedrill Stripe", "Firedrill")
        return order
    db.put("orders", order["order_id"], order, grp=member, seq=int(time.time()))
    telemetry.track("purchase_made", member, {"occasion": occ["id"], "price": order["price"]})
    if add:
        add("buy", f"Bought {order['item']} for ${order['price']:.2f}, order {order['order_id']}. "
                   f"Signed Poppy request (speaker=ai) to {store.STORE_NAME}.", store.STORE_NAME, "Poppy")
        add("pay", f"Payment {pay.get('id')} {pay.get('status')} via {pay.get('tool', pay.get('provider'))}",
            pay.get("provider"), "Firedrill Stripe" if pay.get("provider") == "firedrill-stripe" else "")
    # Tell the human and the family: Gmail receipt + Slack family channel.
    name = MEMBERS[member]["name"]
    if firedrill.live("gmail"):
        g = firedrill.send_receipt(f"Receipt: {order['item']} for {occ['title']}",
                                   f"Your agent bought {order['item']} (${order['price']:.2f}) for {occ['title']} on {occ['date']}.\n"
                                   f"Order {order['order_id']}, payment {pay.get('id')}.\n"
                                   f"Why: {PUBLIC_RECEIPT_URL}/#/receipt/{occ['id']}")
        order["gmail"] = {k: g.get(k) for k in ("ok", "id", "to")}
        if add:
            add("notify", f"Receipt email {'sent' if g['ok'] else 'FAILED'} to {g.get('to')} ({g['tool']})", "Firedrill Gmail", "Firedrill")
    if firedrill.live("slack"):
        s = firedrill.post(f":gift: {name}'s agent bought *{order['item']}* (${order['price']:.2f}) for {occ['title']} "
                           f"({occ['date']}). It's claimed, so nobody else needs to buy one.")
        order["slack"] = {k: s.get(k) for k in ("ok", "channel", "ts")}
        if add:
            add("notify", f"Family channel update {'posted' if s['ok'] else 'FAILED'} ({s['tool']})", "Firedrill Slack", "Firedrill")
    db.put("orders", order["order_id"], order, grp=member, seq=int(time.time()))
    return order


def approve(oid, member):
    """The one human touch: approve the item the agent escalated."""
    occ = get_occasion(oid)
    need = occ.get("needs") or {}
    if need.get("type") != "approve":
        return occ
    steps = occ["steps"]
    add = lambda kind, text, source="", sponsor="": steps.append(
        {"t": _now(), "kind": kind, "text": text, "source": source, "sponsor": sponsor})
    add("approve", f"{MEMBERS[member]['name']} approved once: {need['text']}", "human", "")
    order = buy(occ, member, need["listing_id"], add)
    occ["results"].setdefault(need["slot"], {})["order"] = order
    occ["results"][need["slot"]]["chosen"] = {"id": need["listing_id"], "title": order.get("item"),
                                              "price": order.get("price")}
    occ["status"] = "bought"
    occ.pop("needs", None)
    save(occ)
    return occ


def reset():
    db.clear()
    from .seed import MEMORY
    for ds, about, fact, src in MEMORY:
        fid = f"seed-{abs(hash((ds, about, fact))) % 10**8}"
        db.put("memory", fid, {"id": fid, "dataset": ds, "about": about, "fact": fact, "source": src,
                               "by": "seed", "at": "seed"}, grp=ds)
    from .seed import PAST_ORDERS
    for o in PAST_ORDERS:
        db.put("orders", o["id"], o, grp=o["member"])
