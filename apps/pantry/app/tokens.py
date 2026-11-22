"""Tokens& Observe: metadata-only telemetry for model calls and tool calls (no prompts, outputs or personal data).

Uses the official tokensand_observe SDK when TOKENS_OBSERVE_API_KEY + TOKENS_OBSERVE_INGEST_URL are set.
Every function is a no-op without the SDK or keys, and never raises into the app.
"""
import contextlib
import re
import uuid

from .config import env

_obs = None
SESSION = str(uuid.uuid4())  # one random session per server process


def observer():
    global _obs
    if _obs is None and env("TOKENS_OBSERVE_API_KEY") and env("TOKENS_OBSERVE_INGEST_URL"):
        try:
            from tokensand_observe import Observer
            _obs = Observer(endpoint=env("TOKENS_OBSERVE_INGEST_URL"), api_key=env("TOKENS_OBSERVE_API_KEY"))
        except Exception as e:
            print("tokens& observer unavailable:", type(e).__name__)
            _obs = False
    return _obs or None


def live():
    return observer() is not None


@contextlib.contextmanager
def model_call(model, feature):
    """with model_call(model, 'grocery-extract') as done: ...; done(status, usage)"""
    obs = observer()
    if not obs:
        yield lambda *a, **k: None
        return
    safe_model = re.sub(r"[^a-zA-Z0-9._:-]", "-", model.split("/")[-1])[:100]
    try:
        m = obs.observe(provider="openai", model=safe_model, feature=feature)  # OpenAI-compatible API (Nebius)
        cm = m.__enter__()
    except Exception as e:
        print("tokens& observe failed:", type(e).__name__, str(e)[:80])
        yield lambda *a, **k: None
        return
    state = {"done": False}

    def done(status=200, usage=None):
        try:
            u = {}
            if usage:
                u = {"input_tokens": int(usage.get("prompt_tokens", 0)), "output_tokens": int(usage.get("completion_tokens", 0))}
            m.complete(status=status, usage=u or None)
            state["done"] = True
        except Exception as e:
            print("tokens& complete failed:", type(e).__name__)
    try:
        yield done
    except Exception:
        with contextlib.suppress(Exception):
            m.fail(error_type="network")
        raise
    finally:
        with contextlib.suppress(Exception):
            if not state["done"]:
                m.fail(error_type="network")
        with contextlib.suppress(Exception):
            m.__exit__(None, None, None)


@contextlib.contextmanager
def tool_call(name):
    obs = observer()
    label = re.sub(r"[^a-z0-9_-]", "-", name.lower())[:40].strip("-") or "tool"
    if not label[0].isalpha():
        label = "t-" + label[:38]
    if not obs:
        yield
        return
    try:
        cm = obs.tool(SESSION, label)
        cm.__enter__()
    except Exception as e:
        print("tokens& tool failed:", type(e).__name__, str(e)[:80])
        yield
        return
    try:
        yield
    finally:
        with contextlib.suppress(Exception):
            cm.__exit__(None, None, None)


def flush():
    obs = observer()
    if obs:
        try:
            return obs.flush(timeout=5)
        except Exception as e:
            return {"error": type(e).__name__}
    return {}


def stats():
    obs = observer()
    if not obs:
        return {}
    try:
        return {"requests": obs.stats(), "tools": obs.tool_stats()}
    except Exception:
        return {}
