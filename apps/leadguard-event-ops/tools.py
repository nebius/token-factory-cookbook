"""The tools Kimi can call. Each one reads the event and returns JSON-safe evidence.

These mirror the MCP tools LeadGuard exposes to its ops assistant. Two rules hold for every tool:
- No names or emails: badges are identified by badge id only.
- Read-only, except `draft_sponsor_message`, which only stores a draft marked `awaiting_approval`.
  Nothing is ever sent; a person approves drafts in the UI.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from event import BOOTHS, Event, anomalies

VENUE_TZ = ZoneInfo("America/Denver")


def _t(dt: datetime | None) -> str | None:
    return dt.astimezone(VENUE_TZ).strftime("%H:%M") if dt else None


def _booth(booth_id: str) -> str:
    if booth_id not in BOOTHS:
        raise ValueError(f"unknown booth {booth_id!r}; booths are {', '.join(BOOTHS)}")
    return booth_id


def get_checkin_stats(ev: Event) -> dict:
    last15 = sum(1 for t in ev.checkins.values() if ev.now - t <= timedelta(minutes=15))
    return {"registered": len(ev.attendees), "checked_in": len(ev.checkins), "not_arrived": len(ev.attendees) - len(ev.checkins),
            "checkins_last_15_min": last15, "venue_time": _t(ev.now)}


def get_booth_health(ev: Event) -> dict:
    open_by_booth: dict[str, int] = {}
    for a in anomalies(ev):
        open_by_booth[a["booth_id"]] = open_by_booth.get(a["booth_id"], 0) + 1
    rows = []
    for bid, b in BOOTHS.items():
        scans = [s for s in ev.scans if s.booth_id == bid]
        waiting = sum(d for sid, d in ev.queue_depth.items() if ev.scanner_booth[sid] == bid)
        rows.append({"booth_id": bid, "name": b["name"], "leads": len({s.badge_id for s in scans if s.consent}),
                     "scans": len(scans), "last_scan": _t(max((s.scanned_at for s in scans), default=None)),
                     "scans_waiting_on_devices": waiting, "open_anomalies": open_by_booth.get(bid, 0)})
    return {"booths": rows, "venue_time": _t(ev.now)}


def get_booth_timeline(ev: Event, booth_id: str, minutes: int = 60) -> dict:
    bid = _booth(booth_id)
    since = ev.now - timedelta(minutes=max(1, min(int(minutes), 240)))
    scans = sorted((s for s in ev.scans if s.booth_id == bid and s.scanned_at >= since), key=lambda s: s.scanned_at)
    late = [s for s in scans if s.synced_late]
    return {
        "booth_id": bid, "window_minutes": int(minutes), "scans": len(scans),
        "unique_badges": len({s.badge_id for s in scans}),
        "synced_late": len(late),
        "synced_late_window": [_t(late[0].scanned_at), _t(late[-1].scanned_at)] if late else None,
        "synced_late_received_at": _t(late[-1].received_at) if late else None,
        "scans_waiting_on_devices": sum(d for sid, d in ev.queue_depth.items() if ev.scanner_booth[sid] == bid),
        "last_scan": _t(scans[-1].scanned_at) if scans else None,
        "duplicates_rejected": 0,  # scans are stored by scan_id, so a retried sync can't double-count
        "venue_time": _t(ev.now),
    }


def list_anomalies(ev: Event, booth_id: str | None = None) -> dict:
    rows = []
    for a in anomalies(ev):
        if booth_id and a["booth_id"] != booth_id:
            continue
        row = {k: v for k, v in a.items() if k != "at"}
        row["since"] = _t(a["at"])
        rows.append(row)
    return {"anomalies": rows, "count": len(rows)}


def draft_sponsor_message(ev: Event, booth_id: str, subject: str, body: str) -> dict:
    bid = _booth(booth_id)
    draft = {"id": f"d{len(ev.drafts) + 1}", "booth_id": bid, "subject": str(subject)[:160], "body": str(body)[:4000],
             "status": "awaiting_approval", "created_at": _t(ev.now)}
    ev.drafts.append(draft)
    return {"draft_id": draft["id"], "status": "awaiting_approval", "note": "Saved as a draft. A person must approve it; nothing was sent."}


BOOTH_ARG = {"type": "string", "enum": list(BOOTHS), "description": "Booth id"}
SCHEMAS = [
    {"type": "function", "function": {"name": "get_checkin_stats", "description": "Desk check-in totals and the last 15 minutes.",
                                       "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_booth_health", "description": "Every booth: leads, scans, last scan, scans waiting on devices, open anomalies.",
                                       "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_booth_timeline", "description": "One booth's recent scans, including scans made offline that synced late.",
                                       "parameters": {"type": "object", "properties": {"booth_id": BOOTH_ARG, "minutes": {"type": "integer", "minimum": 1, "maximum": 240}},
                                                      "required": ["booth_id"]}}},
    {"type": "function", "function": {"name": "list_anomalies", "description": "Open integrity anomalies, each with a plain-English explanation. Optionally one booth.",
                                       "parameters": {"type": "object", "properties": {"booth_id": BOOTH_ARG}}}},
    {"type": "function", "function": {"name": "draft_sponsor_message", "description": "Save a draft message to a booth's sponsor. It is NOT sent; an organizer approves it.",
                                       "parameters": {"type": "object", "properties": {"booth_id": BOOTH_ARG, "subject": {"type": "string"}, "body": {"type": "string"}},
                                                      "required": ["booth_id", "subject", "body"]}}},
]
FUNCS = {"get_checkin_stats": get_checkin_stats, "get_booth_health": get_booth_health, "get_booth_timeline": get_booth_timeline,
         "list_anomalies": list_anomalies, "draft_sponsor_message": draft_sponsor_message}


def call(ev: Event, name: str, arguments: str | dict) -> str:
    """Run one tool call from the model. Errors go back to the model as data, not exceptions."""
    if name not in FUNCS:
        return json.dumps({"error": f"no tool named {name!r}"})
    try:
        args = json.loads(arguments or "{}") if isinstance(arguments, str) else dict(arguments or {})
        allowed = SCHEMAS[[s["function"]["name"] for s in SCHEMAS].index(name)]["function"]["parameters"].get("properties", {})
        args = {k: v for k, v in args.items() if k in allowed}
        return json.dumps(FUNCS[name](ev, **args))
    except (ValueError, TypeError, json.JSONDecodeError) as err:
        return json.dumps({"error": str(err)})
