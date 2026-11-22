"""Family memory. One private dataset per member plus a shared "household" dataset.

Access is enforced here, on the server, never by the model: a member can read only
"household" and "<member>_private". When COGNEE_API_KEY is set, facts are also written to
Cognee (one Cognee dataset per memory dataset) and recall uses Cognee search; the local copy
stays the source of truth for the permission check and the audit log.
"""
import time
import uuid

import httpx

from .config import env
from .db import db


def readable(member):
    return ["household", f"{member}_private"]


def can_read(member, dataset):
    return dataset in readable(member)


def cognee_live():
    return bool(env("COGNEE_API_KEY") and env("COGNEE_BASE_URL"))


def cognee_dataset(dataset):
    return f"occasions_{dataset}"


def _cognee_add(dataset, text):
    """Cognee Cloud /api/v1/remember: add text to a dataset and build the graph in the background."""
    if not cognee_live():
        return {"ok": False}
    try:
        r = httpx.post(f"{env('COGNEE_BASE_URL').rstrip('/')}/api/v1/remember", timeout=30,
                       headers={"X-Api-Key": env("COGNEE_API_KEY")},
                       data={"raw_data": [text], "datasetName": cognee_dataset(dataset), "run_in_background": "true"})
        return {"ok": r.status_code < 300, "status": r.status_code, "detail": r.text[:200]}
    except Exception as e:
        return {"ok": False, "detail": type(e).__name__}


def cognee_recall(member, question):
    """Ask Cognee, scoped to the datasets this member may read. Returns (text, datasets) or (None, reason)."""
    if not cognee_live():
        return None, "cognee not configured"
    dsets = [cognee_dataset(d) for d in readable(member)]
    try:
        for attempt in (dsets, [cognee_dataset("household")]):
            r = httpx.post(f"{env('COGNEE_BASE_URL').rstrip('/')}/api/v1/recall", timeout=60,
                           headers={"X-Api-Key": env("COGNEE_API_KEY")},
                           json={"query": question, "datasets": attempt, "topK": 10})
            if r.status_code == 404 and attempt is dsets:
                continue  # a member's private dataset may not exist yet
            break
        if r.status_code >= 300:
            return None, f"cognee recall {r.status_code}"
        j = r.json()
        items = j if isinstance(j, list) else [j]
        parts = []
        for x in items:
            if isinstance(x, dict):
                v = x.get("text") or (x.get("raw") or {}).get("value") or x.get("search_result") or x.get("answer")
                parts.append(v if isinstance(v, str) else str(v))
            else:
                parts.append(str(x))
        return " ".join(p for p in parts if p)[:900], attempt
    except Exception as e:
        return None, type(e).__name__


def seed_cognee():
    """Push every seeded fact into its Cognee dataset once."""
    if not cognee_live() or db.get("claims", "cognee_seeded"):
        return 0
    n = 0
    for f in db.list("memory"):
        if _cognee_add(f["dataset"], f"{f['about']}: {f['fact']} (source: {f['source']})").get("ok"):
            n += 1
    db.put("claims", "cognee_seeded", {"facts": n, "at": time.strftime("%H:%M")}, grp="system")
    return n


def remember(member, about, fact, scope="private", source="told by member"):
    dataset = "household" if scope == "household" else f"{member}_private"
    if not can_read(member, dataset):
        raise PermissionError("cannot write to that dataset")
    fid = f"m-{uuid.uuid4().hex[:8]}"
    doc = {"id": fid, "dataset": dataset, "about": about, "fact": fact, "source": source,
           "by": member, "at": time.strftime("%Y-%m-%d %H:%M")}
    db.put("memory", fid, doc, grp=dataset, seq=int(time.time() * 1000))
    _cognee_add(dataset, f"{about}: {fact} (source: {source})")
    return doc


def recall(member, about=None, purpose=""):
    """Facts this member may see, optionally about one person. Every read is logged."""
    out = []
    for ds in readable(member):
        for f in db.list("memory", grp=ds):
            if about is None or f["about"].lower() == about.lower():
                out.append(f)
    if out:
        log_access(member, about or "*", [f["id"] for f in out], purpose)
    return out


def log_access(member, about, fact_ids, purpose):
    aid = f"a-{uuid.uuid4().hex[:8]}"
    db.put("trail", aid, {"id": aid, "type": "memory_read", "member": member, "about": about,
                          "facts": fact_ids, "purpose": purpose, "at": time.strftime("%H:%M:%S")},
           grp="memory_access", seq=int(time.time() * 1000))


def access_log():
    return db.list("trail", grp="memory_access")


def visible_to(member):
    """For the memory page: what this member's agent can and cannot see (hidden facts are counted, not shown)."""
    all_facts = db.list("memory")
    mine = [f for f in all_facts if can_read(member, f["dataset"])]
    hidden = len(all_facts) - len(mine)
    return {"visible": mine, "hidden_count": hidden}
