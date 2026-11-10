"""A small, deterministic conference: attendees, desk check-ins, booth scanners and lead scans.

This is the data side of LeadGuard (github.com/shivaylamba/leadguard) reduced to the standard
library. The full app keeps the same records in Elasticsearch; here they live in memory so the
recipe runs anywhere. The integrity checks below are a port of LeadGuard's `model.js` and run
without any model: the agent only explains and acts on what they find.

Privacy rule, same as LeadGuard: names and emails never leave this module. Everything the agent
can see is keyed by badge id.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

CLOCK_TOLERANCE = timedelta(minutes=2)  # a scan this much before check-in is clock skew, not fraud
LATE = timedelta(seconds=60)  # a scan received this much after it was made was queued offline
SILENT_AFTER = timedelta(minutes=10)  # an open booth with no scans for this long has gone quiet
MAX_WALK_MPS = 2.0  # faster than this between two booths is not one person walking

BOOTHS = {
    "radar": {"name": "Radar", "xy": (0.0, 0.0)},
    "dash0": {"name": "Dash0", "xy": (40.0, 0.0)},
    "elastic": {"name": "Elastic", "xy": (80.0, 0.0)},
    "gitar": {"name": "Gitar", "xy": (0.0, 60.0)},
    "community": {"name": "Community", "xy": (80.0, 60.0)},
}

EXPLAIN = {
    "never_checked_in": "A badge was scanned at a booth but never checked in at the desk: a shared, copied or "
    "unregistered badge. The sponsor may be counting a lead who isn't really here.",
    "scanned_before_checkin": "A badge was scanned before its holder checked in (beyond clock tolerance): "
    "the badge was likely used by someone else first.",
    "impossible_travel": "The same badge was scanned at two booths faster than a person can walk between them.",
    "silent_booth": "An open booth has sent no scans for a while: the scanner may be off, broken or unattended.",
    "scans_not_syncing": "A scanner reports scans waiting on the device that aren't reaching the server.",
}


@dataclass
class Scan:
    scan_id: str
    badge_id: str
    booth_id: str
    scanner_id: str
    scanned_at: datetime
    received_at: datetime
    consent: bool = True
    notes: str = ""

    @property
    def synced_late(self) -> bool:
        return self.received_at - self.scanned_at > LATE


@dataclass
class Event:
    now: datetime
    attendees: dict[str, dict] = field(default_factory=dict)  # badge_id -> {name, email, company}
    checkins: dict[str, datetime] = field(default_factory=dict)  # badge_id -> first check-in
    scans: list[Scan] = field(default_factory=list)
    queue_depth: dict[str, int] = field(default_factory=dict)  # scanner_id -> scans waiting on the device
    scanner_booth: dict[str, str] = field(default_factory=dict)
    drafts: list[dict] = field(default_factory=list)


FIRST = ["Mira", "Kenji", "Aisha", "Noah", "Fatima", "Mateo", "Lena", "Omar", "Priya", "Jonas", "Sofia", "Ravi"]
LAST = ["Novak", "Silva", "Sharma", "Keller", "Brennan", "Okafor", "Dubois", "Haddad", "Iyer", "Berg"]
COMPANIES = ["Acme Cloud", "Globex", "Hooli", "Initech", "Stark Infra", "Wayne Data", "Tyrell Labs"]
NOTES = [
    "Evaluating OpenTelemetry migration from vendor agents",
    "Wants a follow-up demo next week",
    "Looking for vector search for their support docs",
    "Interested in eBPF security signals",
    "Platform team lead, asked about pricing",
    "",
]


def synthetic(seed: int = 7, now: datetime | None = None) -> Event:
    """A calm morning: 120 attendees, most checked in, steady scanning at every booth."""
    rng = random.Random(seed)
    now = now or datetime(2026, 11, 10, 17, 0, tzinfo=timezone.utc)  # 10:00 in Salt Lake City
    ev = Event(now=now)
    for i in range(120):
        badge = f"B{10000 + i}"
        first, last = rng.choice(FIRST), rng.choice(LAST)
        ev.attendees[badge] = {"name": f"{first} {last}", "email": f"{first}.{last}{i}@example.com".lower(),
                               "company": rng.choice(COMPANIES)}
        if i < 100:  # 20 people haven't arrived yet
            ev.checkins[badge] = now - timedelta(minutes=rng.randint(30, 90))
    for booth in BOOTHS:
        sid = f"scanner-{booth}"
        ev.scanner_booth[sid] = booth
        ev.queue_depth[sid] = 0
    checked = sorted(ev.checkins)
    n = 0
    for booth in BOOTHS:
        for _ in range(14):
            badge = rng.choice(checked)
            t = max(ev.checkins[badge] + timedelta(minutes=5), now - timedelta(minutes=rng.randint(1, 55)))
            if t > now:
                continue
            n += 1
            ev.scans.append(Scan(f"s{n}", badge, booth, f"scanner-{booth}", t, t + timedelta(seconds=2),
                                 consent=rng.random() > 0.1, notes=rng.choice(NOTES)))
    return ev


# ── scenarios: the problems organizers told us about ──────────────────────────
def wifi_drop(ev: Event, booth: str = "radar", scans: int = 6, minutes: int = 12) -> None:
    """The booth's Wi-Fi drops; the phone keeps scanning and syncs everything later, exactly once."""
    back = ev.now - timedelta(minutes=1)
    for k in range(scans):
        t = back - timedelta(minutes=minutes) + timedelta(minutes=k * minutes / scans)
        badge = sorted(ev.checkins)[k * 7 % len(ev.checkins)]
        ev.scans.append(Scan(f"w{booth}{k}", badge, booth, f"scanner-{booth}", t, back, notes="Scanned during Wi-Fi outage"))


def ghost_badge(ev: Event, booth: str = "radar") -> str:
    """A badge nobody checked in with gets scanned: a copied badge, or a colleague's."""
    badge = next(b for b in sorted(ev.attendees) if b not in ev.checkins)
    t = ev.now - timedelta(minutes=3)
    ev.scans.append(Scan(f"g{badge}", badge, booth, f"scanner-{booth}", t, t + timedelta(seconds=2)))
    return badge


def teleport(ev: Event) -> str:
    """One badge at Radar and, 20 seconds later, at Community (100 m away)."""
    badge = sorted(ev.checkins)[3]
    t = ev.now - timedelta(minutes=4)
    ev.scans.append(Scan("t1", badge, "radar", "scanner-radar", t, t + timedelta(seconds=1)))
    ev.scans.append(Scan("t2", badge, "community", "scanner-community", t + timedelta(seconds=20), t + timedelta(seconds=21)))
    return badge


def scanner_stuck(ev: Event, booth: str = "dash0", waiting: int = 23) -> None:
    """A scanner holds scans it can't send, and the booth goes quiet on the server."""
    ev.queue_depth[f"scanner-{booth}"] = waiting
    ev.scans = [s for s in ev.scans if not (s.booth_id == booth and s.scanned_at > ev.now - timedelta(minutes=25))]


# ── integrity checks (no model involved) ──────────────────────────────────────
def _metres(a: str, b: str) -> float:
    (x1, y1), (x2, y2) = BOOTHS[a]["xy"], BOOTHS[b]["xy"]
    return math.hypot(x2 - x1, y2 - y1)


def anomalies(ev: Event) -> list[dict]:
    found: list[dict] = []
    for s in ev.scans:
        first = ev.checkins.get(s.badge_id)
        if first is None:
            found.append({"kind": "never_checked_in", "booth_id": s.booth_id, "badge_id": s.badge_id, "at": s.scanned_at})
        elif s.scanned_at < first - CLOCK_TOLERANCE:
            found.append({"kind": "scanned_before_checkin", "booth_id": s.booth_id, "badge_id": s.badge_id, "at": s.scanned_at})
    by_badge: dict[str, list[Scan]] = {}
    for s in sorted(ev.scans, key=lambda s: s.scanned_at):
        by_badge.setdefault(s.badge_id, []).append(s)
    for badge, seq in by_badge.items():
        for a, b in zip(seq, seq[1:]):
            if a.booth_id == b.booth_id:
                continue
            secs = max((b.scanned_at - a.scanned_at).total_seconds(), 1.0)
            if _metres(a.booth_id, b.booth_id) / secs > MAX_WALK_MPS:
                found.append({"kind": "impossible_travel", "booth_id": b.booth_id, "badge_id": badge, "at": b.scanned_at,
                              "from_booth": a.booth_id, "seconds": int(secs), "metres": int(_metres(a.booth_id, b.booth_id))})
    for booth in BOOTHS:
        last = max((s.scanned_at for s in ev.scans if s.booth_id == booth), default=None)
        if last is None or ev.now - last > SILENT_AFTER:
            found.append({"kind": "silent_booth", "booth_id": booth, "at": last})
    for sid, depth in ev.queue_depth.items():
        if depth > 0:
            found.append({"kind": "scans_not_syncing", "booth_id": ev.scanner_booth[sid], "scanner_id": sid, "waiting": depth, "at": ev.now})
    for a in found:
        a["explain"] = EXPLAIN[a["kind"]]
    return found
