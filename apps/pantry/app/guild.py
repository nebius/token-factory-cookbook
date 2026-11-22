"""Guild AI: run each grocery plan through a Guild agent session (runtime + event log).

POST /v1/workspaces/{workspace}/sessions with session_type "chat", agent_id and an initial prompt that
contains only non-personal plan metadata. The session id goes into the audit trail.
"""
import httpx

from .config import env

B = "https://api.guild.ai/v1"
WORKSPACE = env("GUILD_WORKSPACE_ID")  # your Guild workspace ID
AGENT = env("GUILD_AGENT_ID")  # the Guild agent that reviews plans


def live():
    return bool(env("GUILD_API_KEY") and WORKSPACE and AGENT)


def _h():
    return {"Authorization": f"Bearer {env('GUILD_API_KEY')}"}


def ensure_installed():
    r = httpx.get(f"{B}/workspaces/{WORKSPACE}/workspace_agents", headers=_h(), timeout=20)
    ids = {(x.get("agent") or {}).get("id") or x.get("agent_id") for x in r.json().get("items", [])} if r.status_code == 200 else set()
    if AGENT in ids:
        return True
    r = httpx.post(f"{B}/workspaces/{WORKSPACE}/workspace_agents", headers=_h(), timeout=30, json={"agent_id": AGENT})
    return r.status_code < 300


def start_session(prompt):
    """Returns {"ok", "session_id", "status", "error"}; never raises."""
    if not live():
        return {"ok": False, "error": "not configured"}
    try:
        r = httpx.post(f"{B}/workspaces/{WORKSPACE}/sessions", headers=_h(), timeout=30,
                       json={"session_type": "chat", "agent_id": AGENT, "initial_prompt": prompt[:2000]})
        if r.status_code >= 300 and "install" in r.text.lower():
            ensure_installed()
            r = httpx.post(f"{B}/workspaces/{WORKSPACE}/sessions", headers=_h(), timeout=30,
                           json={"session_type": "chat", "agent_id": AGENT, "initial_prompt": prompt[:2000]})
        j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        return {"ok": r.status_code < 300, "session_id": j.get("id"), "status": r.status_code,
                "error": None if r.status_code < 300 else (j.get("message") or r.text[:160])}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}
