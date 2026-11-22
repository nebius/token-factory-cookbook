"""Settings. Every sponsor integration is optional: with no key, a local stand-in runs instead.

Keys are read from .env (chmod 600) or the environment. They are never logged or sent to the browser.
"""
import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_env():
    f = ROOT / ".env"
    if not f.exists() or os.environ.get("OCCASIONS_NO_DOTENV") == "1":
        return
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()


def env(name, default=""):
    return os.environ.get(name, default)


# Demo clock: pin "today" so the calendar triggers fire on stage. Empty = real date.
TODAY = date.fromisoformat(env("DEMO_TODAY", "2026-11-20"))

DB_PATH = Path(env("DB_PATH", str(ROOT / "data" / "occasions.db")))
STORE_SIGNING_SECRET = env("STORE_SIGNING_SECRET", "local-dev-signing-secret")
PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "http://localhost:8700")

# Main reasoning model: any OpenAI-compatible endpoint (Arcee, Nebius Token Factory, ...).
LLM_BASE_URL = env("LLM_BASE_URL") or env("ARCEE_BASE_URL")
LLM_API_KEY = env("LLM_API_KEY") or env("ARCEE_API_KEY")
LLM_MODEL_SMALL = env("LLM_MODEL_SMALL") or env("ARCEE_MODEL_SMALL")
LLM_MODEL_LARGE = env("LLM_MODEL_LARGE") or env("ARCEE_MODEL_LARGE")


def _tokens_status():
    from . import tokens
    return "live" if tokens.live() else ("pending" if env("TOKENS_OBSERVE_API_KEY") else "fixture")


def integrations():
    """Integration status for the UI: live | gated | blocked | fixture. No secrets."""
    from .db import db
    fd = all(env(f"FIREDRILL_{a}_MCP_URL") for a in ("GOOGLE_CALENDAR", "GMAIL", "SLACK", "STRIPE"))
    return {
        "Nebius Token Factory": "live" if env("NEBIUS_API_KEY") else "fixture",
        "Firedrill (Calendar, Gmail, Slack, Stripe)": "live" if fd else "fixture",
        "Senso": "live" if env("SENSO_API_KEY") else "fixture",
        "Cognee": "live" if env("COGNEE_API_KEY") else "fixture",
        "Superlinked SIE": "live" if env("SIE_API_KEY") else "fixture",
        "Statsig": "live" if env("STATSIG_SERVER_SECRET") else "fixture",
        "Amplitude": "live" if env("AMPLITUDE_API_KEY") else "fixture",
        "SingleStore": "live" if db.kind == "singlestore" else ("blocked" if db.blocker else "fixture"),
        "Persona": "live" if env("PERSONA_LIVE") == "1" else ("gated" if env("PERSONA_API_KEY") else "fixture"),
        "Tokens&": _tokens_status(),
        "Guild AI": "live" if env("GUILD_API_KEY") else "fixture",
    }
