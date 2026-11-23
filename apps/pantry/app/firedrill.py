"""Firedrill synthetic apps: Google Calendar (triggers), Stripe (checkout), Gmail (receipts), Slack (family channel).

All calls go to the per-app MCP URLs in .env. Every call's tool name and outcome is returned so the
agent can put it in the audit trail (never the URL).
"""
import time

from . import mcpcall
from .config import env

APPS = {"calendar": "FIREDRILL_GOOGLE_CALENDAR_MCP_URL", "gmail": "FIREDRILL_GMAIL_MCP_URL",
        "slack": "FIREDRILL_SLACK_MCP_URL", "stripe": "FIREDRILL_STRIPE_MCP_URL"}
TAG = "occasions-agent:"


def live(app):
    return bool(env(APPS[app]))


def call(app, tool, args, timeout=60):
    if not live(app):
        return {"ok": False, "data": {"error": "not configured"}, "tool": f"{app}.{tool}"}
    r = mcpcall.call(env(APPS[app]), tool, args, timeout=timeout)
    r["tool"] = f"firedrill {app}: {tool}"
    return r


# ---------- calendar ----------

def primary_calendar():
    r = call("calendar", "calendarList.list", {})
    for c in (r["data"].get("items") or []) if r["ok"] else []:
        if c.get("primary"):
            return c["id"]
    return "primary"


def list_events(time_min, time_max):
    r = call("calendar", "events.list", {"calendarId": primary_calendar(), "timeMin": time_min, "timeMax": time_max,
                                         "singleEvents": True, "orderBy": "startTime", "maxResults": 100})
    return r["data"].get("items", []) if r["ok"] else []


def ensure_events(seed_events):
    """Write the family's occasions into the synthetic calendar once (tagged so we can recognise them)."""
    cal = primary_calendar()
    existing = list_events("2026-01-01T00:00:00Z", "2027-12-31T00:00:00Z")
    have = {(e.get("description") or "").split(TAG)[-1].split()[0] for e in existing if TAG in (e.get("description") or "")}
    made = []
    for ev in seed_events:
        if ev["id"] in have:
            continue
        from datetime import date, timedelta
        end = (date.fromisoformat(ev["date"]) + timedelta(days=1)).isoformat()  # all-day: end is exclusive
        r = call("calendar", "events.insert", {
            "calendarId": cal, "summary": ev["title"],
            "description": f"Family occasion. {TAG}{ev['id']}",
            "start": {"date": ev["date"]}, "end": {"date": end}})
        made.append((ev["id"], r["ok"]))
    return made


# ---------- stripe ----------

def charge(amount_usd, description, metadata):
    tag = " ".join(f"{k}={v}" for k, v in (metadata or {}).items())
    r = call("stripe", "payment_intents.create", {
        "amount": int(round(amount_usd * 100)), "currency": "usd", "confirm": True, "payment_method": "pm_card_visa",
        "description": f"{description} [{tag}]"[:300]})
    d = r["data"]
    return {"ok": r["ok"] and d.get("status") in ("succeeded", "requires_capture", "processing"),
            "provider": "firedrill-stripe", "id": d.get("id"), "status": d.get("status") or d.get("error"),
            "tool": r["tool"]}


# ---------- gmail ----------

def send_receipt(subject, body):
    me = call("gmail", "profile.get", {"userId": "me"})
    to = me["data"].get("emailAddress", "me") if me["ok"] else "me"
    r = call("gmail", "messages.send", {"userId": "me", "to": [to], "subject": subject, "body": body})
    return {"ok": r["ok"], "id": r["data"].get("id"), "to": to, "tool": r["tool"]}


def send_invite(to, subject, body):
    if not live("gmail"):
        return {"ok": False}
    r = call("gmail", "messages.send", {"userId": "me", "to": [to], "subject": subject, "body": body})
    return {"ok": r["ok"], "id": r["data"].get("id"), "tool": r["tool"]}


# ---------- slack ----------

def family_channel():
    r = call("slack", "conversations.list", {"limit": 200})
    chans = r["data"].get("channels", []) if r["ok"] else []
    fam = next((c for c in chans if c.get("name") == "family"), None)
    if fam:
        return fam["id"]
    c = call("slack", "conversations.create", {"name": "family", "is_private": False})
    if c["ok"] and c["data"].get("channel"):
        return c["data"]["channel"]["id"]
    gen = next((c for c in chans if c.get("is_general")), None)
    return gen["id"] if gen else "general"


def post(text):
    ch = family_channel()
    r = call("slack", "chat.postMessage", {"channel": ch, "text": text})
    return {"ok": r["ok"] and r["data"].get("ok", True), "channel": ch, "ts": r["data"].get("ts"), "tool": r["tool"]}
