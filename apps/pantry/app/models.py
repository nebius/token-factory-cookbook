"""Models: Kimi K3.1 Pro on Nebius Token Factory decides; Superlinked SIE embeddings rank relevance.

The LLM sees listing titles and family facts, never raw listing text (that is untrusted and can
carry injections). Without keys, a deterministic ranker runs so the demo never depends on the network.
"""
import json
import math
import re

import httpx

from .config import env

INJECTION = re.compile(r"(ignore (all |your )?(previous |prior )?instructions|ai (shopping )?agents?:|"
                       r"assistant[s]?,? (must|should) buy|system prompt)", re.I)

NEBIUS_URL = "https://api.tokenfactory.nebius.com/v1"
LLM_MODEL = env("LLM_MODEL", "moonshotai/Kimi-K3.1-Pro")
SIE_MODEL = env("SIE_EMBED_MODEL", "BAAI/bge-m3")


def detect_injection(text):
    m = INJECTION.search(text or "")
    return m.group(0) if m else None


def route_label():
    return {"small": f"SIE {SIE_MODEL}" if env("SIE_API_KEY") else "local-rules",
            "large": LLM_MODEL if env("NEBIUS_API_KEY") else "local-ranker"}


# ---------- Superlinked SIE: relevance by embedding similarity ----------

def sie_scores(query, docs):
    key, base = env("SIE_API_KEY"), env("SIE_ENDPOINT")
    if not (key and base and docs):
        return None
    try:
        r = httpx.post(base.rstrip("/") + "/embeddings", timeout=30, headers={"Authorization": f"Bearer {key}"},
                       json={"model": SIE_MODEL, "input": [query] + docs})
        vecs = [d["embedding"] for d in r.json()["data"]]
        q = vecs[0]

        def cos(a, b):
            return sum(x * y for x, y in zip(a, b)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)) or 1)
        return [round(cos(q, v), 3) for v in vecs[1:]]
    except Exception as e:
        print("sie failed:", type(e).__name__)
        return None


# ---------- Nebius Token Factory: the decision ----------

def _llm(messages, max_tokens=1500, feature="agent-decide"):
    from . import tokens
    with tokens.model_call(LLM_MODEL, feature) as done:
        r = httpx.post(NEBIUS_URL + "/chat/completions", timeout=120, headers={"Authorization": f"Bearer {env('NEBIUS_API_KEY')}"},
                       json={"model": LLM_MODEL, "max_tokens": max_tokens, "temperature": 0, "messages": messages})
        j = r.json()
        done(r.status_code, j.get("usage"))
    content = j["choices"][0]["message"].get("content") or ""
    return content, j.get("usage") or {}


def _json(text):
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {}


def choose(person_facts, candidates, occasion, relevance=None):
    """Pick one candidate. Returns (listing_id, reason, usage)."""
    if env("NEBIUS_API_KEY"):
        try:
            view = [{"id": c["id"], "title": c["title"], "price": c["price"], "tags": c["tags"],
                     **({"relevance": relevance.get(c["id"])} if relevance else {})} for c in candidates]
            content, usage = _llm([
                {"role": "system", "content": "You pick one item for a family occasion from pre-checked safe candidates. "
                 "Use the family facts. Reply only with JSON {\"id\": \"...\", \"reason\": \"one short sentence citing the facts\"}."},
                {"role": "user", "content": json.dumps({"occasion": occasion["title"], "facts": person_facts, "candidates": view})}])
            out = _json(content)
            if out.get("id") in {c["id"] for c in candidates}:
                return out["id"], out.get("reason", ""), {"model": LLM_MODEL, "tokens": usage.get("total_tokens", 0),
                                                          "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens")}
        except Exception as e:
            print("llm choose failed:", type(e).__name__)
    likes = " ".join(person_facts).lower()
    loves = " ".join(f for f in person_facts if re.search(r"\blov(e|es|ed)\b", f, re.I)).lower()

    def score(c):
        return (-sum(2 if t in loves else 1 for t in c["tags"] if t in likes), -(relevance or {}).get(c["id"], 0), c["price"])
    best = sorted(candidates, key=score)[0]
    hits = [t for t in best["tags"] if t in likes]
    reason = (f"matches what we know ({', '.join(hits)})" if hits else "best value among the safe options")
    return best["id"], reason, {"model": "local-ranker", "tokens": 0}
