"""Amplitude (agent events) and Statsig (agent settings as config). Both optional.

Amplitude: HTTP V2 API. Statsig: server get_config for "agent_settings", falling back to defaults.
"""
import threading
import time

import httpx

from .config import env

DEFAULT_SETTINGS = {"act_days_before": 7, "auto_buy": True, "max_listings_checked": 40}
_events = []


def track(event, member, props=None):
    e = {"event_type": event, "user_id": member, "time": int(time.time() * 1000), "event_properties": props or {}}
    _events.append(e)
    key = env("AMPLITUDE_API_KEY")
    if key:
        threading.Thread(target=_send, args=(key, e), daemon=True).start()


def _send(key, e):
    try:
        httpx.post("https://api2.amplitude.com/2/httpapi", json={"api_key": key, "events": [e]}, timeout=5)
    except Exception:
        pass


def recent_events(n=50):
    return _events[-n:]


def settings(member):
    secret = env("STATSIG_SERVER_SECRET")
    if secret:
        try:
            r = httpx.post("https://api.statsig.com/v1/get_config", timeout=5,
                           headers={"statsig-api-key": secret},
                           json={"user": {"userID": member}, "configName": "agent_settings"})
            val = (r.json() or {}).get("value") or {}
            return {**DEFAULT_SETTINGS, **val, "_source": "statsig"}
        except Exception:
            pass
    return {**DEFAULT_SETTINGS, "_source": "default"}
