"""Chat router: tell / ask / delegate / approve. Works the same from the web app, Slack or Telegram."""
import re
import time
import uuid
from datetime import timedelta

from . import agent, memory
from .config import TODAY
from .db import db
from .seed import CATALOG, MEMBERS


def _log(member, who, text):
    cid = f"c-{uuid.uuid4().hex[:8]}"
    db.put("chat", cid, {"id": cid, "member": member, "who": who, "text": text, "at": time.strftime("%H:%M")},
           grp=member, seq=int(time.time() * 1000))


def history(member):
    return db.list("chat", grp=member)


def handle(member, text):
    _log(member, "you", text)
    reply = _route(member, text.strip())
    _log(member, "agent", reply)
    return reply


def _route(member, t):
    low = t.lower()
    m = re.match(r"(\w+)(?:'s| is)? (?:into|loves|likes|really likes) (.+?)(?: now| lately)?\.?$", t, re.I)
    if m:
        who, what = m.group(1).capitalize(), m.group(2)
        memory.remember(member, who, f"loves {what} (updated)", scope="household", source=f"told by {MEMBERS[member]['name']}")
        open_occ = [o for o in agent.list_occasions() if o.get("person") == who and o["status"] != "bought"]
        tail = f" I'll use it for {open_occ[0]['title']}." if open_occ else ""
        return f"Saved for the whole family: {who} loves {what}.{tail}"

    if re.search(r"(coming up|what'?s (next|happening)|upcoming)", low):
        occ = agent.list_occasions()
        if not occ:
            return "Nothing on the calendar yet."
        lines = []
        for o in occ:
            chosen = [r.get("chosen", {}).get("title") for r in o.get("results", {}).values() if r.get("chosen")]
            lines.append(f"• {o['title']} ({o['date']}): {o['status'].replace('_', ' ')}"
                         + (f", {', '.join(chosen)}" if chosen else ""))
        return "\n".join(lines)

    m = re.match(r"(?:get|buy|order) (.+?) for (\w+)(?: by (\w+))?", t, re.I)
    if m:
        what, who = m.group(1), m.group(2).capitalize()
        slot = next((s for c in CATALOG for s in c["slot_tags"] if s.rstrip("s") in what.lower()), None)
        if not slot:
            return f"I can't find '{what}' in the stores I'm connected to yet."
        when = (TODAY + timedelta(days=3)).isoformat()
        occ = agent.delegate(member, f"{what.capitalize()} for {who}", who, when, slot, "gift")
        return _summary(occ)

    if low in ("approve", "yes", "👍", "ok"):
        pend = [o for o in agent.list_occasions() if o.get("needs", {}).get("type") == "approve"]
        if not pend:
            return "Nothing is waiting for your approval."
        return _summary(agent.approve(pend[0]["id"], member))

    return ("I can: remember things (\"Mom is into pottery now\"), tell you what's coming up, "
            "or plan something (\"get flowers for Mom\").")


def _summary(occ):
    if occ["status"] == "bought":
        items = [f"{r['order']['item']} (${r['order']['price']:.2f})" for r in occ["results"].values() if r.get("order")]
        return f"Done: bought {', '.join(items)} for {occ['title']}. Receipt: /#/receipt/{occ['id']}"
    if occ["status"] == "needs_you":
        return f"Needs you: {occ['needs']['text']} Reply 'approve' to buy it."
    if occ["status"] == "covered":
        return f"{occ['title']} is already covered by another family member's agent."
    return f"{occ['title']}: {occ['status']}"
