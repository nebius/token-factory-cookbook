"""Score Kimi K3.1 Pro answers against benchmark ground truth.

Writes:
  results/scored.json   one record per sample: parsed prediction, metric, verdict, what it missed
  results/scores.csv    flat table of the same
  results/viz/*.jpg     overlay per sample (green = ground truth, magenta = Kimi)
"""
import csv
import json
import os
import re
import string

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "results", "raw")
VIZ = os.path.join(ROOT, "results", "viz")
os.makedirs(VIZ, exist_ok=True)

TASKS = {
    "detection": ("Object detection", "COCO (Lin et al., 2014)", "F1 @ IoU 0.5 (class-matched)"),
    "grounding": ("Referring-expression grounding", "RefCOCO (Kazemzadeh et al., 2014; Yu et al., 2016)", "IoU >= 0.5"),
    "counting": ("Object counting", "CountBench (Paiss et al., 2023)", "exact count"),
    "textvqa": ("Scene-text VQA", "TextVQA (Singh et al., 2019)", "VQA accuracy"),
    "docvqa": ("Document VQA", "DocVQA (Mathew et al., 2021)", "ANLS"),
    "chartqa": ("Chart QA", "ChartQA (Masry et al., 2022)", "relaxed accuracy (5%)"),
    "mathvista": ("Visual math reasoning", "MathVista (Lu et al., 2024)", "exact answer"),
    "vsr": ("Spatial-relation reasoning", "VSR (Liu et al., 2023)", "true/false accuracy"),
    "pope": ("Object hallucination probe", "POPE adversarial (Li et al., 2023)", "yes/no accuracy"),
    "screenspot": ("GUI element grounding", "ScreenSpot (Cheng et al., 2024)", "click inside target"),
}


# ---------------------------------------------------------------- parsing helpers
def parse_json(text):
    if not text:
        return None
    blocks = re.findall(r"```(?:json)?\s*(.*?)```", text, re.S)
    cands = blocks[::-1] + [text]
    for c in cands:
        c = c.strip()
        try:
            return json.loads(c)
        except Exception:
            pass
        # last {...} span
        start = c.rfind("{")
        while start != -1:
            for end in range(len(c), start, -1):
                if c[end - 1] != "}":
                    continue
                try:
                    return json.loads(c[start:end])
                except Exception:
                    continue
            start = c.rfind("{", 0, start)
    return None


def norm(s):
    s = str(s).lower().strip()
    s = s.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
    s = "".join(ch for ch in s if ch not in string.punctuation)
    s = re.sub(r"\b(a|an|the)\b", " ", s)
    return " ".join(s.split())


def to_float(s):
    try:
        return float(str(s).replace(",", "").replace("%", "").replace("$", "").strip())
    except Exception:
        return None


def iou(a, b):
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def fix_box(b):
    if not b or len(b) != 4:
        return None
    x1, y1, x2, y2 = [float(v) for v in b]
    return [min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)]


def levenshtein(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def anls(pred, answers):
    best = 0.0
    p = " ".join(str(pred).lower().strip().strip('"').split())
    for a in answers:
        a = " ".join(str(a).lower().strip().strip('"').split())
        d = levenshtein(p, a) / max(len(p), len(a), 1)
        best = max(best, 1 - d if d < 0.5 else 0.0)
    return best


ALIASES = {"remote control": "remote", "television": "tv", "tv monitor": "tv", "monitor": "tv", "sofa": "couch",
           "motorbike": "motorcycle", "cellphone": "cell phone", "mobile phone": "cell phone", "table": "dining table",
           "plant": "potted plant", "computer mouse": "mouse", "hand bag": "handbag", "doughnut": "donut"}


def canon(label):
    l = str(label).lower().strip()
    return ALIASES.get(l, l)


# ---------------------------------------------------------------- per-task scoring
def score(s, pred):
    t, gt = s["task"], s["gt"]
    W, H = s["width"], s["height"]
    r = dict(verdict="miss", metric=0.0, pred_text="", gt_text="", note="")
    if pred is None:
        r["note"] = "no parseable answer"
        return r

    if t == "detection":
        objs = [o for o in (pred.get("objects") or []) if fix_box(o.get("bbox"))]
        preds = [dict(label=canon(o.get("label")), bbox=fix_box(o["bbox"])) for o in objs]
        gts = [dict(label=canon(o["label"]), bbox=o["bbox"]) for o in gt]
        pairs = sorted(((iou(p["bbox"], g["bbox"]), i, j) for i, p in enumerate(preds) for j, g in enumerate(gts)
                        if p["label"] == g["label"]), reverse=True)
        mp, mg = {}, {}
        for v, i, j in pairs:
            if v >= 0.5 and i not in mp and j not in mg:
                mp[i], mg[j] = v, i
        tp = len(mg)
        prec = tp / len(preds) if preds else 0.0
        rec = tp / len(gts) if gts else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        missed = [gts[j]["label"] for j in range(len(gts)) if j not in mg]
        extra = [preds[i]["label"] for i in range(len(preds)) if i not in mp]
        r.update(metric=round(f1, 3), precision=round(prec, 3), recall=round(rec, 3), tp=tp,
                 n_pred=len(preds), n_gt=len(gts), missed=missed, extra=extra,
                 pred_boxes=preds, matched_pred=sorted(mp), matched_gt=sorted(mg),
                 pred_text=f"{len(preds)} boxes", gt_text=f"{len(gts)} boxes")
        r["verdict"] = "hit" if f1 >= 0.8 else ("partial" if f1 >= 0.4 else "miss")
        bits = []
        if missed:
            bits.append("missed " + ", ".join(missed))
        if extra:
            bits.append("extra/unmatched " + ", ".join(extra))
        r["note"] = "; ".join(bits) or "all objects found"
        return r

    if t == "grounding":
        b = fix_box(pred.get("bbox"))
        v = iou(b, gt) if b else 0.0
        r.update(metric=round(v, 3), pred_box=b, verdict="hit" if v >= 0.5 else "miss",
                 pred_text=f"IoU {v:.2f}", gt_text=s["expression"])
        r["note"] = f"IoU {v:.2f} with the annotated box"
        return r

    if t == "counting":
        c = pred.get("count")
        try:
            c = int(round(float(c)))
        except Exception:
            c = None
        pts = [p for p in (pred.get("points") or []) if isinstance(p, (list, tuple)) and len(p) == 2]
        r.update(pred_count=c, points=pts, metric=1.0 if c == gt else 0.0, verdict="hit" if c == gt else "miss",
                 pred_text=str(c), gt_text=str(gt))
        r["note"] = "exact" if c == gt else f"counted {c}, truth {gt}"
        return r

    if t in ("textvqa", "docvqa"):
        a = str(pred.get("answer", ""))
        eb = fix_box(pred.get("evidence_bbox")) if pred.get("evidence_bbox") else None
        r.update(pred_text=a, evidence_bbox=eb)
        if t == "textvqa":
            n = sum(norm(a) == norm(g) for g in gt)
            acc = min(n / 3, 1.0)
            r.update(metric=round(acc, 3), gt_text=max(set(gt), key=gt.count))
            r["verdict"] = "hit" if acc >= 1 else ("partial" if acc > 0 else "miss")
            r["note"] = f"{n}/10 annotators gave this answer"
        else:
            v = anls(a, gt)
            if any(norm(a) == norm(g) for g in gt):
                v = 1.0
            r.update(metric=round(v, 3), gt_text=gt[0].strip('"'))
            r["verdict"] = "hit" if v >= 0.8 else ("partial" if v >= 0.5 else "miss")
            r["note"] = f"ANLS {v:.2f}"
        return r

    if t == "chartqa":
        a = str(pred.get("answer", ""))
        g = gt[0]
        pf, gf = to_float(a), to_float(g)
        if pf is not None and gf is not None:
            ok = abs(pf - gf) <= 0.05 * abs(gf) if gf != 0 else pf == 0
        else:
            ok = norm(a) == norm(g)
        r.update(pred_text=a, gt_text=g, metric=1.0 if ok else 0.0, verdict="hit" if ok else "miss")
        r["note"] = "within 5%" if ok and pf is not None and pf != gf else ("exact" if ok else "wrong value")
        return r

    if t == "mathvista":
        a = str(pred.get("answer", "")).strip()
        g = str(gt)
        if s.get("question_type") == "multi_choice" and s.get("choices"):
            m = re.match(r"^\(?([A-Za-z])\)?[.):]?\s*$", a) or re.match(r"^\(?([A-Za-z])\)?[.):]\s", a)
            if m and ord(m.group(1).upper()) - 65 < len(s["choices"]):
                a_txt = s["choices"][ord(m.group(1).upper()) - 65]
            else:
                a_txt = a
            ok = norm(a_txt) == norm(g)
            r.update(pred_text=f"{a} ({a_txt})" if a_txt != a else a)
        else:
            pf, gf = to_float(a), to_float(g)
            ok = (pf is not None and gf is not None and abs(pf - gf) < 1e-6) or norm(a) == norm(g)
            r.update(pred_text=a)
        r.update(gt_text=g, metric=1.0 if ok else 0.0, verdict="hit" if ok else "miss",
                 note="correct" if ok else "wrong answer")
        return r

    if t == "vsr":
        a = pred.get("answer")
        if isinstance(a, str):
            a = a.strip().lower() in ("true", "yes")
        ok = bool(a) == gt
        boxes = [dict(label=o.get("label"), bbox=fix_box(o.get("bbox"))) for o in (pred.get("objects") or [])
                 if fix_box(o.get("bbox"))]
        r.update(pred_text=str(bool(a)).lower(), gt_text=str(gt).lower(), metric=1.0 if ok else 0.0,
                 verdict="hit" if ok else "miss", pred_boxes=boxes, note="correct" if ok else "wrong judgement")
        return r

    if t == "pope":
        a = str(pred.get("answer", "")).strip().lower()
        a = "yes" if a.startswith("y") else ("no" if a.startswith("n") else a)
        ok = a == gt
        b = fix_box(pred.get("bbox")) if pred.get("bbox") else None
        r.update(pred_text=a, gt_text=gt, metric=1.0 if ok else 0.0, verdict="hit" if ok else "miss", pred_box=b)
        r["note"] = "correct" if ok else ("hallucinated the object" if a == "yes" else "missed a present object")
        return r

    if t == "screenspot":
        p = pred.get("point")
        x1, y1, x2, y2 = gt[0] * W, gt[1] * H, gt[2] * W, gt[3] * H
        ok = False
        if isinstance(p, (list, tuple)) and len(p) == 2:
            ok = x1 <= p[0] <= x2 and y1 <= p[1] <= y2
        r.update(pred_point=p, gt_box=[x1, y1, x2, y2], pred_text=str(p), gt_text=s["instruction"],
                 metric=1.0 if ok else 0.0, verdict="hit" if ok else "miss")
        r["note"] = "click inside target" if ok else "click outside target"
        return r
    raise ValueError(t)


# ---------------------------------------------------------------- overlays
GREEN, MAGENTA, WHITE = (34, 197, 94), (236, 72, 153), (255, 255, 255)


def font(sz, bold=False):
    for p, idx in [("/System/Library/Fonts/HelveticaNeue.ttc", 1 if bold else 0),
                   ("/System/Library/Fonts/Helvetica.ttc", 1 if bold else 0),
                   ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
                    else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0)]:
        try:
            return ImageFont.truetype(p, sz, index=idx)
        except Exception:
            continue
    return ImageFont.load_default(size=sz)


def draw_box(d, b, col, w, label=None, f=None, dashed=False):
    x1, y1, x2, y2 = b
    if dashed:
        step = 12
        for x in range(int(x1), int(x2), step * 2):
            d.line([(x, y1), (min(x + step, x2), y1)], fill=col, width=w)
            d.line([(x, y2), (min(x + step, x2), y2)], fill=col, width=w)
        for y in range(int(y1), int(y2), step * 2):
            d.line([(x1, y), (x1, min(y + step, y2))], fill=col, width=w)
            d.line([(x2, y), (x2, min(y + step, y2))], fill=col, width=w)
    else:
        d.rectangle(b, outline=col, width=w)
    if label and f:
        tw = d.textlength(label, font=f)
        ty = y1 - f.size - 6 if y1 - f.size - 6 > 0 else y1 + 2
        d.rectangle([x1, ty, x1 + tw + 10, ty + f.size + 6], fill=col)
        d.text((x1 + 5, ty + 2), label, fill=WHITE, font=f)


def overlay(s, r):
    im = Image.open(os.path.join(ROOT, s["image"])).convert("RGB")
    scale = 1.0
    if max(im.size) > 1400:
        scale = 1400 / max(im.size)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    S = lambda b: [v * scale for v in b]
    d = ImageDraw.Draw(im)
    lw = max(3, round(max(im.size) / 220))
    f = font(max(14, round(max(im.size) / 40)), bold=True)
    t = s["task"]
    if t == "detection":
        for j, g in enumerate(s["gt"]):
            draw_box(d, S(g["bbox"]), GREEN, lw, dashed=True)
        for i, p in enumerate(r.get("pred_boxes", [])):
            draw_box(d, S(p["bbox"]), MAGENTA, lw, p["label"], f)
    elif t == "grounding":
        draw_box(d, S(s["gt"]), GREEN, lw, dashed=True)
        if r.get("pred_box"):
            draw_box(d, S(r["pred_box"]), MAGENTA, lw, f"IoU {r['metric']:.2f}", f)
    elif t == "counting":
        rad = max(6, lw * 2)
        for k, (x, y) in enumerate(r.get("points", []), 1):
            x, y = x * scale, y * scale
            d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=MAGENTA, outline=WHITE, width=2)
            d.text((x + rad + 2, y - rad), str(k), fill=MAGENTA, font=f, stroke_width=2, stroke_fill=WHITE)
    elif t in ("textvqa", "docvqa", "pope"):
        b = r.get("evidence_bbox") or r.get("pred_box")
        if b:
            draw_box(d, S(b), MAGENTA, lw, r.get("pred_text", "")[:40], f)
    elif t == "vsr":
        for p in r.get("pred_boxes", []):
            draw_box(d, S(p["bbox"]), MAGENTA, lw, p["label"], f)
    elif t == "screenspot":
        draw_box(d, S(r["gt_box"]), GREEN, lw, dashed=True)
        p = r.get("pred_point")
        if isinstance(p, (list, tuple)) and len(p) == 2:
            x, y = p[0] * scale, p[1] * scale
            rad = max(10, lw * 3)
            d.ellipse([x - rad, y - rad, x + rad, y + rad], outline=MAGENTA, width=lw)
            d.line([(x - rad * 1.6, y), (x + rad * 1.6, y)], fill=MAGENTA, width=max(2, lw // 2))
            d.line([(x, y - rad * 1.6), (x, y + rad * 1.6)], fill=MAGENTA, width=max(2, lw // 2))
    path = os.path.join(VIZ, s["id"].replace("/", "__") + ".jpg")
    im.save(path, quality=85)
    return os.path.relpath(path, ROOT)


# ---------------------------------------------------------------- main
def main():
    manifest = json.load(open(os.path.join(ROOT, "data", "manifest.json")))
    out = []
    for s in manifest:
        rawp = os.path.join(RAW, s["id"].replace("/", "__") + ".json")
        raw = json.load(open(rawp)) if os.path.exists(rawp) else {}
        pred = parse_json(raw.get("content"))
        r = score(s, pred) if raw.get("content") else dict(verdict="not run", metric=0.0, note=raw.get("error", "not run"),
                                                           pred_text="", gt_text="")
        r["viz"] = overlay(s, r) if raw.get("content") else None
        usage = raw.get("usage") or {}
        rec = dict(id=s["id"], task=s["task"], task_name=TASKS[s["task"]][0], benchmark=TASKS[s["task"]][1],
                   metric_name=TASKS[s["task"]][2], image=s["image"], width=s["width"], height=s["height"],
                   question=s.get("question") or s.get("expression") or s.get("caption") or s.get("instruction")
                   or "Detect all COCO objects",
                   gt=s["gt"], prediction=pred, latency_s=raw.get("latency_s"),
                   completion_tokens=usage.get("completion_tokens"),
                   reasoning_tokens=(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
                   reasoning_excerpt=(raw.get("reasoning") or "")[:600], **r)
        out.append(rec)
    json.dump(out, open(os.path.join(ROOT, "results", "scored.json"), "w"), indent=1)
    cols = ["id", "task_name", "benchmark", "question", "pred_text", "gt_text", "metric_name", "metric", "verdict",
            "note", "latency_s", "completion_tokens"]
    with open(os.path.join(ROOT, "results", "scores.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for rec in out:
            w.writerow(rec)
    # summary
    print(f"{'task':32s} hit partial miss  mean-metric")
    for t, (name, bench, metric) in TASKS.items():
        rs = [x for x in out if x["task"] == t]
        h = sum(x["verdict"] == "hit" for x in rs)
        p = sum(x["verdict"] == "partial" for x in rs)
        m = sum(x["verdict"] == "miss" for x in rs)
        mm = sum(x["metric"] for x in rs) / max(len(rs), 1)
        print(f"{name:32s} {h:3d} {p:7d} {m:4d}  {mm:.2f}  ({metric})")
    tot = len(out)
    print("overall hits", sum(x["verdict"] == "hit" for x in out), "/", tot)


if __name__ == "__main__":
    main()
