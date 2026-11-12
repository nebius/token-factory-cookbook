"""Fetch a small, seeded random sample from ten published vision benchmarks.

Every sample keeps its benchmark ground truth so the model's output can be scored
afterwards. Images are saved under data/<task>/ and everything else goes into
data/manifest.json.
"""
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
N = int(os.environ.get("N_PER_TASK", "6"))
SEED = 31
HF = "https://datasets-server.huggingface.co"


CACHE = os.path.join(DATA, "_hf_cache.json")
_cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}


def get_json(path, **params):
    url = f"{HF}/{path}?" + urllib.parse.urlencode(params)
    if url in _cache:
        return _cache[url]
    for attempt in range(10):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                d = json.load(r)
            _cache[url] = d
            json.dump(_cache, open(CACHE, "w"))
            time.sleep(0.6)
            return d
        except Exception as e:  # datasets-server is occasionally flaky / rate limited
            print("  retry", attempt, e, file=sys.stderr)
            time.sleep(min(90, 5 * 2 ** attempt))
    raise RuntimeError(url)


def row(ds, cfg, split, idx):
    return get_json("rows", dataset=ds, config=cfg, split=split, offset=idx, length=1)["rows"][0]["row"]


def total(ds, cfg, split):
    return get_json("rows", dataset=ds, config=cfg, split=split, offset=0, length=1)["num_rows_total"]


def save_image(src, task, sid):
    os.makedirs(os.path.join(DATA, task), exist_ok=True)
    for ext in ("jpg", "png"):
        done = os.path.join(DATA, task, f"{sid}.{ext}")
        if os.path.exists(done):
            return os.path.relpath(done, ROOT), Image.open(done).size
    tmp = os.path.join(DATA, task, f"{sid}.download")
    for attempt in range(5):
        try:
            req = urllib.request.Request(src, headers={"User-Agent": "kimi-vision-eval/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r, open(tmp, "wb") as f:
                f.write(r.read())
            break
        except Exception as e:
            print("  img retry", attempt, e, file=sys.stderr)
            time.sleep(2 + attempt * 3)
    im = Image.open(tmp)
    im.load()
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    ext = "png" if im.format == "PNG" else "jpg"
    path = os.path.join(DATA, task, f"{sid}.{ext}")
    if ext == "jpg":
        im.convert("RGB").save(path, quality=95)
    else:
        im.save(path)
    os.remove(tmp)
    return os.path.relpath(path, ROOT), im.size


def pick(rng, n_total, k):
    return sorted(rng.sample(range(n_total), k))


samples = []


def add(task, sid, src, gt, **extra):
    path, (w, h) = save_image(src, task, sid)
    s = dict(task=task, id=f"{task}/{sid}", image=path, width=w, height=h, gt=gt, **extra)
    samples.append(s)
    print(f"  {s['id']}  {w}x{h}")


rng = random.Random(SEED)

# 1. COCO object detection (Lin et al., 2014) -- val2017, images with 2-8 non-crowd boxes
print("detection")
fr = get_json("first-rows", dataset="detection-datasets/coco", config="default", split="val")
names = [f for f in fr["features"] if f["name"] == "objects"][0]["type"]["feature"]["category"]["names"]
pool = [r["row"] for r in fr["rows"] if 2 <= len(r["row"]["objects"]["bbox"]) <= 8]
for r in rng.sample(pool, N):
    objs = [dict(label=names[c], bbox=b) for c, b in zip(r["objects"]["category"], r["objects"]["bbox"])]
    add("detection", f"coco_{r['image_id']}", r["image"]["src"], objs, source="COCO val2017",
        coco_classes=names)

# 2. RefCOCO referring expression grounding (Kazemzadeh et al., 2014; Yu et al., 2016)
print("grounding")
t = total("lmms-lab-encoder/RefCOCO", "default", "val")
for i in pick(rng, t, N):
    r = row("lmms-lab-encoder/RefCOCO", "default", "val", i)
    x, y, w, h = r["bbox"]
    add("grounding", f"refcoco_{r['question_id']}", r["image"]["src"], [x, y, x + w, y + h],
        expression=r["answer"][0], all_expressions=r["answer"], source="RefCOCO val")

# 3. CountBench object counting (Paiss et al., 2023)
print("counting")
t = total("vikhyatk/CountBenchQA", "default", "test")
for i in pick(rng, t, N):
    r = row("vikhyatk/CountBenchQA", "default", "test", i)
    add("counting", f"countbench_{i}", r["image"]["src"], int(r["number"]), question=r["question"],
        source="CountBench test")

# 4. TextVQA scene-text VQA (Singh et al., 2019)
print("textvqa")
t = total("lmms-lab-encoder/textvqa", "default", "validation")
for i in pick(rng, t, N):
    r = row("lmms-lab-encoder/textvqa", "default", "validation", i)
    add("textvqa", f"textvqa_{r['question_id']}", r["image"]["src"], r["answers"], question=r["question"],
        source="TextVQA val")

# 5. DocVQA document VQA (Mathew et al., 2021)
print("docvqa")
t = total("lmms-lab-encoder/DocVQA", "DocVQA", "validation")
for i in pick(rng, t, N):
    r = row("lmms-lab-encoder/DocVQA", "DocVQA", "validation", i)
    add("docvqa", f"docvqa_{r['questionId']}", r["image"]["src"], r["answers"], question=r["question"],
        source="DocVQA val")

# 6. ChartQA (Masry et al., 2022)
print("chartqa")
t = total("HuggingFaceM4/ChartQA", "default", "test")
for i in pick(rng, t, N):
    r = row("HuggingFaceM4/ChartQA", "default", "test", i)
    add("chartqa", f"chartqa_{i}", r["image"]["src"], r["label"], question=r["query"],
        human_written=(r["human_or_machine"] == 0), source="ChartQA test")

# 7. MathVista visual math reasoning (Lu et al., 2024)
print("mathvista")
t = total("AI4Math/MathVista", "default", "testmini")
for i in pick(rng, t, N):
    r = row("AI4Math/MathVista", "default", "testmini", i)
    add("mathvista", f"mathvista_{r['pid']}", r["decoded_image"]["src"], r["answer"], question=r["query"],
        choices=r["choices"], question_type=r["question_type"], answer_type=r["answer_type"],
        precision=r["precision"], category=r["metadata"].get("category"),
        skills=r["metadata"].get("skills"), source="MathVista testmini")

# 8. VSR visual spatial reasoning (Liu et al., 2023)
print("vsr")
t = total("cambridgeltl/vsr_random", "default", "test")
for i in pick(rng, t, N):
    r = row("cambridgeltl/vsr_random", "default", "test", i)
    add("vsr", f"vsr_{i}", r["image_link"], bool(r["label"]), caption=r["caption"], relation=r["relation"],
        source="VSR (random split) test")

# 9. POPE object hallucination, adversarial split (Li et al., 2023) -- balanced yes/no
print("pope")
t = total("lmms-lab-encoder/POPE", "Full", "adversarial")
want = {"yes": N // 2, "no": N - N // 2}
for i in rng.sample(range(t), 200):
    if not any(want.values()):
        break
    r = row("lmms-lab-encoder/POPE", "Full", "adversarial", i)
    if want.get(r["answer"], 0) <= 0:
        continue
    want[r["answer"]] -= 1
    add("pope", f"pope_{r['question_id']}", r["image"]["src"], r["answer"], question=r["question"],
        source="POPE adversarial (COCO val2014)")

# 10. ScreenSpot GUI grounding (Cheng et al., 2024 -- SeeClick)
print("screenspot")
t = total("bevaya/ScreenSpot", "default", "test")
for i in pick(rng, t, N):
    r = row("bevaya/ScreenSpot", "default", "test", i)
    add("screenspot", f"screenspot_{i}", r["image"]["src"], r["bbox"], instruction=r["instruction"],
        data_type=r["data_type"], platform=r["data_source"], source="ScreenSpot test",
        bbox_format="normalized xyxy")

with open(os.path.join(DATA, "manifest.json"), "w") as f:
    json.dump(samples, f, indent=1)
print("wrote", len(samples), "samples")
