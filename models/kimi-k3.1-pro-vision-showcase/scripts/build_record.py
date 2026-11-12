"""Build RECORD.md (the written record) and results/record.html (visual gallery) from scored results."""
import html
import json
import os
import statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(ROOT, "results", "scored.json")))
AUDIT = json.load(open(os.path.join(ROOT, "data", "audit.json")))

TASK_DESC = {
    "detection": ("Find and box every object from the 80 COCO categories.",
                  "Lin et al., *Microsoft COCO: Common Objects in Context*, ECCV 2014",
                  "Kimi gets the 80 category names and returns one labelled box per instance. A box counts if it has the right class and IoU >= 0.5 with an unused ground-truth box. Hit = F1 >= 0.8, partial = F1 >= 0.4."),
    "grounding": ("Box the single object a short human phrase refers to ('left dude', 'girl in blue coat').",
                  "Kazemzadeh et al., *ReferItGame*, EMNLP 2014; Yu et al., *Modeling Context in Referring Expressions*, ECCV 2016",
                  "Hit = IoU >= 0.5 with the annotated box (the standard RefCOCO accuracy rule)."),
    "counting": ("Count the objects in an image, here with a point on each one.",
                 "Paiss et al., *Teaching CLIP to Count to Ten*, ICCV 2023 (CountBench)",
                 "Hit = exact count. Kimi also returns a point per instance, which is drawn on the overlay."),
    "textvqa": ("Answer a question that requires reading text in a natural photo.",
                "Singh et al., *Towards VQA Models That Can Read*, CVPR 2019 (TextVQA)",
                "Standard VQA accuracy: min(#annotators who gave the answer / 3, 1). Hit = 1.0, partial = above 0."),
    "docvqa": ("Answer a question about a scanned document page.",
               "Mathew et al., *DocVQA: A Dataset for VQA on Document Images*, WACV 2021",
               "ANLS (normalised edit similarity, 0 below 0.5). Hit = ANLS >= 0.8."),
    "chartqa": ("Read values off a chart and do light arithmetic on them.",
                "Masry et al., *ChartQA*, Findings of ACL 2022",
                "Relaxed accuracy: numbers within 5% of the label, otherwise exact match."),
    "mathvista": ("Mathematical reasoning grounded in a figure: plots, geometry, puzzles, measurement.",
                  "Lu et al., *MathVista*, ICLR 2024",
                  "Exact answer (option text for multiple choice, value for free form)."),
    "vsr": ("Decide whether a spatial statement about two objects is true ('The truck is below the boat').",
            "Liu et al., *Visual Spatial Reasoning*, TACL 2023 (VSR)",
            "True/false accuracy. Kimi also boxes the two objects it reasoned about."),
    "pope": ("Yes/no questions about whether an object is present, with adversarial negatives that tend to co-occur.",
             "Li et al., *Evaluating Object Hallucination in Large Vision-Language Models*, EMNLP 2023 (POPE)",
             "Yes/no accuracy on a balanced 3 yes / 3 no sample. 'Yes' answers also return a box."),
    "screenspot": ("Given a UI instruction ('clear browsing data'), say exactly where to click on a screenshot.",
                   "Cheng et al., *SeeClick: Harnessing GUI Grounding for Advanced Visual GUI Agents*, ACL 2024 (ScreenSpot)",
                   "Hit = the click point falls inside the target element's box."),
}
ORDER = list(TASK_DESC)


def tally(rs):
    return dict(hit=sum(r["verdict"] == "hit" for r in rs), partial=sum(r["verdict"] == "partial" for r in rs),
                miss=sum(r["verdict"] == "miss" for r in rs),
                disputed=sum(AUDIT.get(r["id"], {}).get("kind") == "disputed" for r in rs))


def md():
    by = {t: [r for r in R if r["task"] == t] for t in ORDER}
    tot = tally(R)
    lat = [r["latency_s"] for r in R if r["latency_s"]]
    tok = [r["completion_tokens"] for r in R if r["completion_tokens"]]
    L = []
    L += ["# Kimi K3.1 Pro: ten vision tasks, what it did and what it missed", "",
          "Model `moonshotai/Kimi-K3.1-Pro`, served by Nebius Token Factory (OpenAI-compatible endpoint "
          "`https://api.tokenfactory.nebius.com/v1`). Run on 2026-11-05.", "",
          "## How this was run", "",
          "- **Ten tasks taken from the vision-language literature**, each tied to a published benchmark (below).",
          "- **Six samples per task, 60 in all**, drawn at random (seed 31) from each benchmark's public evaluation split "
          "via the Hugging Face datasets server. Nothing was hand-picked. Two constraints: COCO detection images were limited "
          "to those with 2-8 boxes so the overlays stay readable, and POPE was balanced to 3 'yes' / 3 'no'.",
          "- One request per sample, the image as base64, default sampling, a single attempt. Prompts ask for a JSON answer "
          "(boxes and points in the image's own pixel frame); they are saved in `results/raw/`.",
          "- Scored automatically against the benchmark labels with each benchmark's usual rule (`scripts/score.py`). Every "
          "sample that was not a clean hit was then checked by eye (`data/audit.json`).",
          "- **This is a demonstration, not a benchmark score.** Six samples per task is far too few to estimate accuracy; "
          "the point is to show, on real benchmark items, what the model can do and where it slips.", "",
          f"## Scorecard: {tot['hit']} / {len(R)} hits", "",
          f"{tot['hit']} hits, {tot['partial']} partial, {tot['miss']} misses. Of the {tot['partial'] + tot['miss']} non-hits, "
          f"{tot['disputed']} look like benchmark label problems on inspection (marked *disputed*); the official count does "
          "not change for them.", "",
          "| # | Task | Benchmark | Hit | Partial | Miss | Disputed | Mean metric |",
          "|---|---|---|---|---|---|---|---|"]
    for i, t in enumerate(ORDER, 1):
        rs = by[t]
        k = tally(rs)
        mm = sum(r["metric"] for r in rs) / len(rs)
        L.append(f"| {i} | {rs[0]['task_name']} | {rs[0]['benchmark']} | {k['hit']} | {k['partial']} | {k['miss']} | "
                 f"{k['disputed']} | {mm:.2f} ({rs[0]['metric_name']}) |")
    L += ["", f"Latency per request: median {st.median(lat):.1f} s, range {min(lat):.1f}-{max(lat):.1f} s. "
          f"Completion tokens (mostly reasoning): median {st.median(tok):.0f}, total {sum(tok):,}. Detection prompts "
          "take about 45-90 s because the model reasons through every box. The four slowest requests were all misses "
          "or partials: the ticket count (375 s, 11.6k tokens), the bench grounding (131 s), a detection partial "
          "(112 s) and a VSR miss (109 s). Long reasoning is a fair signal that the model is unsure.", ""]

    L += ["## The ten tasks", ""]
    for i, t in enumerate(ORDER, 1):
        rs = by[t]
        what, cite, rule = TASK_DESC[t]
        k = tally(rs)
        L += [f"### {i}. {rs[0]['task_name']}: {k['hit']}/6", "", f"**What it tests.** {what}", "",
              f"**Source.** {cite}.", "", f"**Scoring.** {rule}", "",
              "| Sample | Question | Kimi said | Truth | Verdict | Note |", "|---|---|---|---|---|---|"]
        for r in rs:
            q = r["question"].split("Question:")[-1].strip().split("\n")[0][:90]
            gt = r["gt_text"] if t not in ("grounding", "screenspot") else "annotated box"
            note = AUDIT.get(r["id"], {}).get("note") or r["note"]
            kind = AUDIT.get(r["id"], {}).get("kind")
            v = r["verdict"] + (f" ({kind})" if kind and kind != "real" else "")
            cell = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
            L.append(f"| [{r['id'].split('/')[1]}]({r['viz']}) | {cell(q)} | {cell(r['pred_text'])[:60]} | "
                     f"{cell(gt)[:50]} | {v} | {cell(note)} |")
        L.append("")

    L += ["## What it missed", "",
          "Every non-hit, after review. *Real* = the model was wrong. *Ambiguous* = the question or relation is vague; "
          "the benchmark verdict stands. *Disputed* = the benchmark label looks wrong on inspection.", ""]
    for kind in ("real", "ambiguous", "disputed"):
        items = [r for r in R if AUDIT.get(r["id"], {}).get("kind") == kind]
        L += [f"**{kind.capitalize()} ({len(items)})**", ""]
        for r in items:
            L.append(f"- `{r['id']}` ({r['task_name']}, {r['verdict']}): {AUDIT[r['id']]['note']}")
        L.append("")
    L += ["Detection 'hits' can still miss objects; those are listed in the detection table notes (for example an "
          "occluded teddy bear or a second mouse).", ""]

    L += ["## What it did well", "",
          "- **Charts and plots: 6/6 ChartQA, 5/6 MathVista.** Exact values off bar, line and pie charts, including sums.",
          "- **Pixel-precise localisation.** RefCOCO boxes at IoU 0.91-0.98 on four of six; 5/6 ScreenSpot clicks inside the "
          "target, including small icons on 2560x1440 desktop screenshots.",
          "- **Reading.** 5/6 TextVQA and 5/6 DocVQA, often with a correct evidence box around the text it read.",
          "- **Counting with pointing.** 10 butterflies, 9 fruit photos, 6 chairs: each instance pointed and numbered.", ""]
    L += ["## Files", "",
          "- `data/manifest.json`: the 60 samples with benchmark ground truth; images in `data/<task>/`.",
          "- `results/raw/`: every request's prompt, the model's answer, its reasoning, token usage and latency.",
          "- `results/scored.json`, `results/scores.csv`: parsed predictions, metric, verdict per sample.",
          "- `results/viz/`: one overlay per sample (green dashed = ground truth, magenta = Kimi).",
          "- `results/record.html`: the visual gallery of all 60 (written locally by `scripts/build_record.py`, not committed).",
          "- `data/audit.json`: the manual review of every non-hit.",
          "- Re-run: `python3 scripts/fetch_samples.py && python3 scripts/run_kimi.py && python3 scripts/score.py && "
          "python3 scripts/build_record.py`.", ""]
    open(os.path.join(ROOT, "RECORD.md"), "w").write("\n".join(L))


def thumb(rel):
    """Embed each overlay as a small JPEG so the gallery is one self-contained file."""
    import base64, io
    from PIL import Image
    im = Image.open(os.path.join(ROOT, rel)).convert("RGB")
    im.thumbnail((900, 900))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def gallery():
    tot = tally(R)
    cards = []
    for i, t in enumerate(ORDER, 1):
        rs = [r for r in R if r["task"] == t]
        k = tally(rs)
        items = []
        for r in rs:
            kind = AUDIT.get(r["id"], {}).get("kind")
            note = AUDIT.get(r["id"], {}).get("note") or r["note"]
            q = r["question"].split("Question:")[-1].strip().split("\n")[0]
            gt = r["gt_text"] if t not in ("grounding", "screenspot") else "annotated box (green)"
            badge = r["verdict"] + (f" · {kind}" if kind and kind != "real" else "")
            items.append(f"""<figure class="s {r['verdict']}">
  <img loading="lazy" src="{thumb(r['viz'])}" alt="{html.escape(r['id'])}">
  <figcaption><span class="b {r['verdict']}">{html.escape(badge)}</span>
  <p class="q">{html.escape(q[:160])}</p>
  <p><b>Kimi:</b> {html.escape(str(r['pred_text'])[:120])}</p><p><b>Truth:</b> {html.escape(str(gt)[:120])}</p>
  <p class="n">{html.escape(note)}</p></figcaption></figure>""")
        what, cite, _ = TASK_DESC[t]
        cards.append(f"""<section><h2>{i}. {html.escape(rs[0]['task_name'])} <span class="t">{k['hit']}/6</span></h2>
<p class="d">{html.escape(what)} <i>{html.escape(cite.replace('*', ''))}</i></p><div class="g">{''.join(items)}</div></section>""")
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kimi Vision Record</title><style>
:root{{--bg:#f6f7f9;--fg:#14161a;--mut:#5b6270;--card:#fff;--line:#e3e6eb;--hit:#16a34a;--partial:#d97706;--miss:#dc2626}}
@media (prefers-color-scheme:dark){{:root{{--bg:#111316;--fg:#eef0f3;--mut:#9aa2ae;--card:#1a1d21;--line:#2a2e34}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,Inter,Helvetica,sans-serif}}
main{{max-width:1280px;margin:0 auto;padding:32px 16px 64px}}h1{{font-size:30px;margin:0 0 6px}}.sub{{color:var(--mut);margin:0 0 28px}}
h2{{font-size:20px;margin:36px 0 4px}}.t{{color:var(--mut);font-weight:500}}.d{{color:var(--mut);margin:0 0 14px}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}}
figure{{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}}
figure img{{width:100%;height:220px;object-fit:contain;background:#0b0c0e;display:block}}
figcaption{{padding:10px 12px 12px}}figcaption p{{margin:4px 0;font-size:13.5px}}.q{{font-weight:600}}.n{{color:var(--mut)}}
.b{{display:inline-block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#fff;padding:2px 8px;border-radius:4px}}
.b.hit{{background:var(--hit)}}.b.partial{{background:var(--partial)}}.b.miss{{background:var(--miss)}}
.legend{{font-size:13.5px;color:var(--mut)}}.legend b.g1{{color:#22c55e}}.legend b.m1{{color:#ec4899}}
</style></head><body><main>
<h1>Kimi K3.1 Pro on ten vision tasks</h1>
<p class="sub">{tot['hit']} of {len(R)} hits ({tot['partial']} partial, {tot['miss']} miss, {tot['disputed']} of those disputed labels) on random samples from ten published benchmarks · served by Nebius Token Factory · <span class="legend"><b class="g1">green dashed</b> = ground truth, <b class="m1">magenta</b> = Kimi</span></p>
{''.join(cards)}</main></body></html>"""
    open(os.path.join(ROOT, "results", "record.html"), "w").write(page)


md()
gallery()
print("wrote RECORD.md and results/record.html")
