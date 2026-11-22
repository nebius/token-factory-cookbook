"""Demo Market: a store that speaks the Personal Agent Protocol (Poppy).

- Discovery: GET /.well-known/poppy.json lists the API, scopes and sign-in.
- Every agent request carries a signed header (HMAC over the body with a short-lived session key),
  a per-store user id, and a speaker declaration ("ai").
- Payment: Stripe test mode when STRIPE_SECRET_KEY is set, otherwise a local test payment.
"""
import hashlib
import hmac
import json
import time
import uuid

import httpx

from .config import PUBLIC_BASE_URL, STORE_SIGNING_SECRET, env
from .seed import CATALOG

STORE_NAME = "Demo Market"


def discovery():
    return {
        "poppy_version": "1.0",
        "name": STORE_NAME,
        "apis": [{"type": "openapi", "url": f"{PUBLIC_BASE_URL}/store/openapi.json"}],
        "scopes": [{"name": "catalog:read", "description": "Browse products"},
                   {"name": "orders:create", "description": "Place orders within the user's mandate"}],
        "authorization_server": f"{PUBLIC_BASE_URL}/.well-known/oauth-authorization-server",
        "agent_browsing": False,
    }


def catalog(slot=None):
    return [c for c in CATALOG if slot is None or slot in c["slot_tags"]]


def sign(member, body: dict):
    """Agent side: per-store pairwise user id + HMAC signature over the canonical body."""
    payload = json.dumps(body, sort_keys=True)
    session = f"sess-{uuid.uuid4().hex[:10]}"
    store_user = hashlib.sha256(f"{member}:{STORE_NAME}".encode()).hexdigest()[:16]
    sig = hmac.new(STORE_SIGNING_SECRET.encode(), f"{session}.{payload}".encode(), hashlib.sha256).hexdigest()
    return {"Poppy-Session": session, "Poppy-User": store_user, "Poppy-Speaker": "ai", "Poppy-Signature": sig}


def verify(headers, body: dict):
    payload = json.dumps(body, sort_keys=True)
    want = hmac.new(STORE_SIGNING_SECRET.encode(), f"{headers['Poppy-Session']}.{payload}".encode(),
                    hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, headers.get("Poppy-Signature", ""))


def _pay(amount, description, metadata=None):
    from . import firedrill
    if firedrill.live("stripe"):
        return firedrill.charge(amount, description, metadata or {})
    key = env("STRIPE_SECRET_KEY")
    if key and key.startswith("sk_test_"):
        try:
            r = httpx.post("https://api.stripe.com/v1/payment_intents", auth=(key, ""), timeout=15, data={
                "amount": int(round(amount * 100)), "currency": "usd", "payment_method": "pm_card_visa",
                "confirm": "true", "description": description,
                "automatic_payment_methods[enabled]": "true", "automatic_payment_methods[allow_redirects]": "never"})
            j = r.json()
            if j.get("id"):
                return {"provider": "stripe-test", "id": j["id"], "status": j.get("status")}
        except Exception:
            pass
    return {"provider": "local-test", "id": f"pay_{uuid.uuid4().hex[:12]}", "status": "succeeded"}


def place_order(headers, body):
    """Store side. Rejects unsigned requests."""
    if not verify(headers, body):
        return {"ok": False, "error": "bad signature"}
    item = next((c for c in CATALOG if c["id"] == body["listing_id"]), None)
    if not item:
        return {"ok": False, "error": "unknown item"}
    pay = _pay(item["price"], f"{item['title']} for {body.get('occasion', '')}",
               {"listing": item["id"], "occasion": body.get("occasion", "")[:40], "agent": "occasions"})
    return {"ok": True, "order_id": f"DM-{uuid.uuid4().hex[:6].upper()}", "item": item["title"],
            "price": item["price"], "payment": pay, "speaker": headers.get("Poppy-Speaker"),
            "at": time.strftime("%Y-%m-%d %H:%M")}
