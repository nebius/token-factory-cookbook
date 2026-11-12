"""Run Kimi K3.1 Pro (Nebius Token Factory) on every sample in data/manifest.json.

Raw responses (answer, reasoning, usage, latency) go to results/raw/<task>__<sample>.json.
Re-running skips samples that already have a successful response.
"""
import base64
import concurrent.futures as cf
import json
import mimetypes
import os
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "results", "raw")
os.makedirs(RAW, exist_ok=True)

MODEL = os.environ.get("NEBIUS_MODEL", "moonshotai/Kimi-K3.1-Pro")
BASE_URL = os.environ.get("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1").rstrip("/")
URL = f"{BASE_URL}/chat/completions"


def load_key():
    key = os.environ.get("NEBIUS_API_KEY")
    if not key:
        raise SystemExit("Set NEBIUS_API_KEY to your Token Factory API key.")
    return key


def fence(keys):
    return ("\n\nThink it through, then end your reply with a single JSON object inside a ```json code block "
            f"with exactly these keys: {keys}")


def build_prompt(s):
    W, H, t = s["width"], s["height"], s["task"]
    dims = f"The image is {W}x{H} pixels; give all coordinates as integer pixel coordinates in that frame."
    if t == "detection":
        cats = ", ".join(s["coco_classes"])
        return (f"Detect every object in this image that belongs to one of the 80 COCO categories: {cats}.\n"
                f"Return one entry per object instance, with the COCO category name and a tight bounding box "
                f"[x1, y1, x2, y2]. {dims}"
                + fence('{"objects": [{"label": "<coco category>", "bbox": [x1, y1, x2, y2]}, ...]}'))
    if t == "grounding":
        return (f'Find the single object referred to by this expression: "{s["expression"]}".\n'
                f"Return its tight bounding box [x1, y1, x2, y2]. {dims}"
                + fence('{"bbox": [x1, y1, x2, y2]}'))
    if t == "counting":
        return (f"{s['question']}\nPoint to the centre of each instance you count, then give the total. {dims}"
                + fence('{"points": [[x, y], ...], "count": <integer>}'))
    if t == "textvqa":
        return (f"{s['question']}\nAnswer with a short word or phrase (as written in the image when the answer is "
                f"text in the image). Also give the bounding box of the image region you used as evidence. {dims}"
                + fence('{"answer": "<short answer>", "evidence_bbox": [x1, y1, x2, y2] or null}'))
    if t == "docvqa":
        return (f"{s['question']}\nAnswer concisely, copying the exact text from the document where possible. "
                f"Also give the bounding box of the document region containing the answer. {dims}"
                + fence('{"answer": "<short answer>", "evidence_bbox": [x1, y1, x2, y2] or null}'))
    if t == "chartqa":
        return (f"{s['question']}\nAnswer with a single number or a short phrase, without units or % signs."
                + fence('{"answer": "<answer>"}'))
    if t == "mathvista":
        return s["question"] + fence('{"answer": "<final answer exactly as the hint asks: option letter or value>"}')
    if t == "vsr":
        return (f'Is this statement about the image true or false?\n"{s["caption"]}"\n'
                f"Also give bounding boxes for the two objects the statement mentions. {dims}"
                + fence('{"answer": true or false, "objects": [{"label": "<name>", "bbox": [x1, y1, x2, y2]}, ...]}'))
    if t == "pope":
        return (f"{s['question']} Answer yes or no. If yes, give the bounding box of one instance. {dims}"
                + fence('{"answer": "yes" or "no", "bbox": [x1, y1, x2, y2] or null}'))
    if t == "screenspot":
        return (f'This is a screenshot of a user interface. Instruction: "{s["instruction"]}".\n'
                f"Where exactly should you click to carry out this instruction? {dims}"
                + fence('{"point": [x, y]}'))
    raise ValueError(t)


def data_url(path):
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()


def run_one(s):
    out = os.path.join(RAW, s["id"].replace("/", "__") + ".json")
    if os.path.exists(out):
        prev = json.load(open(out))
        if prev.get("content"):
            return s["id"], "cached", prev.get("latency_s")
    prompt = build_prompt(s)
    body = {
        "model": MODEL,
        "max_tokens": 24000,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": data_url(os.path.join(ROOT, s["image"]))}},
            {"type": "text", "text": prompt},
        ]}],
    }
    err = None
    for attempt in range(4):
        t0 = time.time()
        try:
            r = requests.post(URL, headers={"Authorization": f"Bearer {KEY}"}, json=body, timeout=900)
            lat = time.time() - t0
            if r.status_code != 200:
                err = f"HTTP {r.status_code}: {r.text[:300]}"
                time.sleep(10 * (attempt + 1))
                continue
            d = r.json()
            msg = d["choices"][0]["message"]
            rec = dict(id=s["id"], task=s["task"], model=MODEL, prompt=prompt, content=msg.get("content"),
                       reasoning=msg.get("reasoning_content") or msg.get("reasoning"),
                       finish_reason=d["choices"][0].get("finish_reason"), usage=d.get("usage"),
                       latency_s=round(lat, 1))
            json.dump(rec, open(out, "w"), indent=1)
            return s["id"], "ok", rec["latency_s"]
        except Exception as e:
            err = repr(e)
            time.sleep(10 * (attempt + 1))
    json.dump(dict(id=s["id"], task=s["task"], prompt=prompt, content=None, error=err), open(out, "w"), indent=1)
    return s["id"], "error: " + str(err)[:200], None


if __name__ == "__main__":
    KEY = load_key()
    manifest = json.load(open(os.path.join(ROOT, "data", "manifest.json")))
    only = sys.argv[1:]  # optional task or id filters
    if only:
        manifest = [s for s in manifest if s["task"] in only or s["id"] in only]
    workers = int(os.environ.get("WORKERS", "8"))
    print(f"running {len(manifest)} samples with {workers} workers", flush=True)
    with cf.ThreadPoolExecutor(workers) as ex:
        for sid, status, lat in ex.map(run_one, manifest):
            print(f"{sid:40s} {status}  {lat}s", flush=True)
