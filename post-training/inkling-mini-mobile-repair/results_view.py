"""Summarize paired repairs and make a portable browser gallery of the actual patched pages."""

import json, math, asyncio, io, os
from pathlib import Path
from collections import Counter
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright
from pages import DATA, ROOT, read_rows
from browser_check import browser_binary, css_patch

OUT = Path(os.environ.get("REPAIR_RESULTS_DIR", ROOT / "results"))


def encode(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace(
        "<", "\\u003c"
    )


def cases(split):
    suffix = "" if split == "primary" else "-external"
    return (
        read_rows(
            DATA / ("test-pages.jsonl" if not suffix else "external-pages.jsonl")
        ),
        {
            arm: read_rows(OUT / (arm + suffix + "-checked.jsonl"))
            for arm in ("broken", "base", "tuned")
        },
        {
            arm: read_rows(
                OUT
                / (
                    (
                        ("adapted" if arm == "tuned" else "base")
                        if not suffix
                        else arm + suffix
                    )
                    + ".jsonl"
                )
            )
            for arm in ("base", "tuned")
        },
    )


def summary(split):
    pages, grades, raw = cases(split)
    ids = [r["id"] for r in pages]
    assert all(
        [r["id"] for r in rows] == ids
        for rows in list(grades.values()) + list(raw.values())
    )
    arms = {}
    for arm, rs in grades.items():
        criterion_keys = rs[0]["checks"].keys()
        arms[arm] = {
            "pages": len(rs),
            "pass": sum(r["pass"] for r in rs),
            "desktop_unchanged": sum(r["desktop_unchanged"] for r in rs),
            "defects_fixed": sum(r["reported_defects_fixed"] for r in rs),
            "total_defects": sum(r["reported_defects"] for r in rs),
            "per_check": {k: sum(r["checks"][k] for r in rs) for k in criterion_keys},
        }
        if arm != "broken":
            arms[arm].update(
                capped=sum(r["hit_cap"] for r in raw[arm]),
                output_tokens=sum(r["output_tokens"] for r in raw[arm]),
            )
    counts = Counter(
        (b["pass"], t["pass"]) for b, t in zip(grades["base"], grades["tuned"])
    )
    won, lost = counts[False, True], counts[True, False]
    n = won + lost
    p = (
        1
        if n == 0
        else min(1, 2 * sum(math.comb(n, k) for k in range(min(won, lost) + 1)) / 2**n)
    )
    return {
        "arms": arms,
        "paired": {
            "tuned_only": won,
            "base_only": lost,
            "both": counts[True, True],
            "neither": counts[False, False],
            "exact_sign_test_two_sided": p,
        },
    }


def cost():
    training = json.loads((OUT / "metrics.json").read_text())
    phases = {"training_run": training["run_seconds"]}
    rate_path = DATA / "rates.json"
    rates = json.loads(rate_path.read_text())["models"]["moonshotai/Kimi-K3.1-Pro"]
    records = [
        json.loads(f.read_text()) for f in (ROOT / "work/teacher").glob("*.json")
    ]
    inp = sum(r["usage"]["prompt_tokens"] for r in records)
    output = sum(r["usage"]["completion_tokens"] for r in records)
    cached = sum(
        (r["usage"].get("prompt_tokens_details") or {}).get("cached_tokens", 0)
        for r in records
    )
    api = (
        (inp - cached) * rates["input_price_per_million_tokens"]
        + cached * rates["input_cached_price_per_million_tokens"]
        + output * rates["output_price_per_million_tokens"]
    ) / 1e6
    for label in ["base", "adapted", "base-external", "tuned-external"]:
        phases[label] = json.loads((OUT / (label + "-timing.json")).read_text())[
            "wall_seconds"
        ]
    gpu = sum(phases.values()) / 3600 * 4.5
    return {
        "gpu_name": training["gpu"],
        "training_seconds": training["train_seconds"],
        "training_usd": training["train_seconds"] / 3600 * 4.5,
        "peak_allocated_gib": training["peak_allocated_gib"],
        "h100_usd_per_hour": 4.5,
        "gpu_phase_seconds": phases,
        "gpu_usd": gpu,
        "total_measured_gpu_seconds": sum(phases.values()),
        "kimi_calls": len(records),
        "kimi_tokens": {"input": inp, "cached": cached, "output": output},
        "kimi_usd": api,
        "kimi_elapsed_seconds": max(r["end"] for r in records)
        - min(r["start"] for r in records),
        "total_usd": gpu + api,
        "excludes": "Idle VM time, environment setup, storage, uploads and previous experiments.",
    }


def all_rows():
    rows = []
    for split in ["primary", "external"]:
        ps, gs, raw = cases(split)
        for i, p in enumerate(ps):
            rows.append(
                {k: p[k] for k in ["id", "family", "ticket", "html", "flags"]}
                | {
                    "split": split,
                    "grades": {a: gs[a][i] for a in gs},
                    "patches": {
                        "broken": "",
                        **{a: css_patch(raw[a][i]["raw"])[0] for a in raw},
                    },
                }
            )
    return rows


def showcase(rows):
    template = (ROOT / "replay.html").read_text()
    (OUT / "showcase.html").write_text(template.replace("__CASES__", encode(rows)))


def font(size, bold=False):
    stem = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/" + stem, size)
    except OSError:
        return ImageFont.load_default()


async def example(rows):
    pick = next(
        (
            r
            for r in rows
            if r["grades"]["tuned"]["pass"] and not r["grades"]["base"]["pass"]
        ),
        rows[0],
    )
    canvas = Image.new("RGB", (1193, 904), "#f7f8f5")
    pen = ImageDraw.Draw(canvas)
    pen.text(
        (22, 12), pick["family"] + " at 375 px", font=font(31, True), fill="#1b302b"
    )
    pen.text(
        (22, 55),
        "Actual browser renders of the same landing page",
        font=font(17),
        fill="#486055",
    )
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=browser_binary())
        pg = await b.new_page(viewport={"width": 375, "height": 756}, offline=True)
        for i, (arm, label) in enumerate(
            [
                ("broken", "Original page"),
                ("base", "Base Mini repair"),
                ("tuned", "Kimi-trained Mini repair"),
            ]
        ):
            x = 20 + i * 392
            pen.text((x, 95), label, font=font(19, True), fill="#1c342b")
            await pg.set_content(pick["html"])
            if pick["patches"][arm]:
                await pg.add_style_tag(content=pick["patches"][arm])
            blob = await pg.screenshot(animations="disabled")
            img = Image.open(io.BytesIO(blob)).convert("RGB")
            canvas.paste(img, (x, 132))
            pen.rectangle((x - 1, 131, x + 375, 888), outline="#b0b8ad")
        await b.close()
    canvas.save(OUT / "before-after.png", optimize=True)
    (OUT / "featured.json").write_text(
        json.dumps(
            {
                "id": pick["id"],
                "family": pick["family"],
                "selection": "first primary-order case passed by the adapter and failed by the base, or first case if none",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    report = {s: summary(s) for s in ["primary", "external"]}
    (OUT / "scores.json").write_text(json.dumps(report, indent=2))
    if (OUT / "metrics.json").is_file() and (ROOT / "work/teacher").is_dir():
        (OUT / "costs.json").write_text(json.dumps(cost(), indent=2))
    rows = all_rows()
    showcase(rows)
    asyncio.run(example(rows))
    print(json.dumps({s: r["paired"] for s, r in report.items()}))
