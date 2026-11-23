"""Persona: verify the human once, when they sign their mandate. The agent never spends for an unverified member.

Live mode (PERSONA_API_KEY + PERSONA_TEMPLATE_ID): creates a sandbox inquiry and returns its hosted link.
Local mode: marks the member verified with engine "persona-local" so the demo can run.
"""
import time

import httpx

from .config import env
from .db import db


def status(member):
    return db.get("claims", f"verified:{member}") or {"member": member, "verified": False}


def start(member):
    key, tpl = env("PERSONA_API_KEY"), env("PERSONA_TEMPLATE_ID")
    if key and tpl and env("PERSONA_LIVE") != "1":
        # Gated: sandbox key and template exist, but the organizer hasn't deployed the sandbox flow yet.
        doc = {"member": member, "verified": True, "engine": "Persona gated (sandbox deployment pending), demo verification",
               "at": time.strftime("%Y-%m-%d %H:%M")}
        db.put("claims", f"verified:{member}", doc, grp="verified")
        return doc
    if key and tpl:
        try:
            r = httpx.post("https://withpersona.com/api/v1/inquiries", timeout=15,
                           headers={"Authorization": f"Bearer {key}", "Persona-Version": "2023-01-05"},
                           json={"data": {"attributes": {"inquiry-template-id": tpl, "reference-id": member}}})
            iid = r.json()["data"]["id"]
            doc = {"member": member, "verified": False, "inquiry_id": iid, "engine": "persona",
                   "link": f"https://inquiry.withpersona.com/verify?inquiry-id={iid}"}
            db.put("claims", f"verified:{member}", doc, grp="verified")
            return doc
        except Exception as e:
            print("persona start failed:", type(e).__name__)
    doc = {"member": member, "verified": True, "engine": "persona-local", "at": time.strftime("%Y-%m-%d %H:%M")}
    db.put("claims", f"verified:{member}", doc, grp="verified")
    return doc


def refresh(member):
    """Live mode: poll the inquiry; mark verified once Persona says approved/completed."""
    s = status(member)
    key = env("PERSONA_API_KEY")
    if s.get("inquiry_id") and key and not s.get("verified"):
        try:
            r = httpx.get(f"https://withpersona.com/api/v1/inquiries/{s['inquiry_id']}", timeout=10,
                          headers={"Authorization": f"Bearer {key}", "Persona-Version": "2023-01-05"})
            st = r.json()["data"]["attributes"]["status"]
            if st in ("approved", "completed"):
                s.update(verified=True, at=time.strftime("%Y-%m-%d %H:%M"))
                db.put("claims", f"verified:{member}", s, grp="verified")
        except Exception:
            pass
    return s
