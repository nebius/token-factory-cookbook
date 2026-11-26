"""Build deterministic, split-disjoint landing pages and mobile bug reports."""

from __future__ import annotations
import hashlib, html, json, random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"


def write_rows(path, rows):
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))


def read_rows(path):
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# Every test family has different markup structure, copy and CSS class names from training.
FAMILIES = {
    "train": [
        (
            "Aster",
            "Insight to share",
            "product analytics",
            "Get the report",
            "See metrics",
        ),
        (
            "Fold",
            "Print in good company",
            "print club",
            "Meet the printers",
            "Browse editions",
        ),
        (
            "Grove",
            "A calmer close",
            "finance operations",
            "Start a trial",
            "View the ledger",
        ),
        (
            "Kiln",
            "Build with the grain",
            "woodworking studio",
            "Book a class",
            "Browse tools",
        ),
        (
            "Vela",
            "One clear schedule",
            "team scheduling",
            "Plan a session",
            "See the calendar",
        ),
        (
            "Ripple",
            "Learn a new current",
            "swim school",
            "Find a lesson",
            "Meet coaches",
        ),
        (
            "Depot",
            "Room for the next idea",
            "storage studio",
            "Reserve space",
            "View the plans",
        ),
        (
            "Orbit",
            "Catch the next signal",
            "radio collective",
            "Tune in live",
            "Find a show",
        ),
        (
            "Ochre",
            "Color your next project",
            "paint specialists",
            "Choose colors",
            "Order a sample",
        ),
    ],
    "validation": [
        (
            "Sage",
            "Take a quieter route",
            "walking tours",
            "Join a walk",
            "Browse routes",
        ),
        (
            "Press",
            "A new edition every week",
            "print magazine",
            "Read an issue",
            "View the archive",
        ),
    ],
    "test": [
        (
            "Hearth",
            "A seat at every table",
            "supper club",
            "Reserve a seat",
            "Explore the menu",
        ),
        (
            "Folio",
            "A home for new work",
            "artist portfolio",
            "View the collection",
            "Meet the artists",
        ),
        (
            "Switchyard",
            "Make every connection",
            "rail passes",
            "Find a rail pass",
            "Explore routes",
        ),
        (
            "Tandem",
            "Release with confidence",
            "software deployments",
            "Start deploying",
            "Watch a demo",
        ),
        (
            "Fieldnote",
            "Look closer outside",
            "nature journal",
            "Read field notes",
            "Explore the atlas",
        ),
        (
            "Pitch",
            "Make room for live music",
            "concert listings",
            "Find a concert",
            "See the lineup",
        ),
    ],
}
VOCAB = {
    "train": [
        "frame",
        "spread",
        "ribbon",
        "column",
        "canvas",
        "entry",
        "button",
        "panel",
        "folio",
        "crate",
        "ledge",
        "cluster",
        "lane",
        "mast",
        "block",
        "floor",
        "well",
        "dock",
        "banner",
        "shelf",
    ],
    "validation": [
        "assembly",
        "bundle",
        "platform",
        "plank",
        "mount",
        "facade",
        "cubicle",
        "bar",
        "node",
        "wall",
        "branch",
        "rack",
        "niche",
        "arm",
        "ante",
    ],
    "test": [
        "portal",
        "plaza",
        "signal",
        "terrace",
        "bank",
        "zone",
        "hatch",
        "rail",
        "tray",
        "pocket",
        "slot",
        "deck",
        "tier",
        "chip",
        "board",
        "stage",
        "bay",
        "plate",
        "belt",
        "yard",
    ],
}
FLAGS = ("heading", "actions", "layout", "cards", "art", "form")
ISSUE = {
    "heading": "The main headline runs past the available space. Keep the full headline readable.",
    "actions": "The pair of hero actions must form two full-width rows on phones with a usable touch area and readable labels.",
    "layout": "The desktop hero columns must become a vertical sequence on phones, copy first and preview below it.",
    "cards": "The three feature cards must stack into one column on phones in their original order.",
    "art": "The product preview extends beyond its panel. Keep it visible within the available width.",
    "form": "The email field and sign-up button must stack on phones and stay fully reachable.",
}
TRAIN_COMBOS = [(f,) for f in FLAGS] + [
    ("heading", "actions"),
    ("layout", "art"),
    ("cards", "form"),
    ("heading", "cards"),
    ("actions", "layout"),
    ("art", "form"),
    ("heading", "form"),
    ("layout", "cards"),
]
TEST_COMBOS = [
    ("layout", "actions", "form"),
    ("heading", "art", "cards"),
    ("heading", "layout", "form"),
    ("actions", "cards", "art"),
]
PALETTES = [
    ("#e8eee8", "#1d3c32", "#b4d9a3"),
    ("#f8ede6", "#53352e", "#f39b73"),
    ("#ebecf5", "#2b345a", "#b0baf3"),
    ("#f8f1df", "#3a372b", "#edca65"),
]


def build(split, index):
    fams = FAMILIES[split]
    fi = index % len(fams)
    variant = index // len(fams)
    family, head, industry, cta1, cta2 = fams[fi]
    # In train vary single and paired defects. Four new three-defect combinations comprise test.
    combos = TEST_COMBOS if split == "test" else TRAIN_COMBOS
    flags = (
        combos[(variant + fi * 3) % len(combos)]
        if split != "test"
        else combos[variant % len(combos)]
    )
    seed = int(hashlib.sha256(f"{split}/{index}".encode()).hexdigest()[:12], 16)
    rng = random.Random(seed)
    words = rng.sample(VOCAB[split], 12)
    # Use semantic family-scoped names so CSS is legible while keeping selectors unseen across splits.
    scope = family.lower()
    roles = [
        "wrap",
        "hero",
        "copy",
        "title",
        "actions",
        "link",
        "preview",
        "art",
        "cards",
        "card",
        "form",
        "field",
    ]
    c = {r: scope + "-" + w for r, w in zip(roles, words)}
    name = lambda k: "." + c[k]
    tag = lambda k: f'class="{c[k]}"'
    bg, ink, accent = PALETTES[(fi + variant) % 4]
    width = rng.choice([430, 455, 480, 510])
    wide = rng.choice([320, 360, 390])
    cols = rng.choice([235, 245, 260])
    open_hero, close_hero = {
        "train": [("section", "section"), ("div", "div")],
        "validation": [("article", "article")],
        "test": [("header", "header"), ("section", "section")],
    }[split][fi % (1 if split == "validation" else 2)]
    font = rng.choice([52, 54, 58, 60])
    rule = lambda select, style: f"{select}{{{style}}}"
    A = lambda r, style: rule(name(r), style)
    # Some page styles use a scoped selector, like a real component stylesheet.
    css = (
        f":root{{--paper:{bg};--ink:{ink};--accent:{accent}}}*{{box-sizing:border-box}}body{{margin:0;background:var(--paper);color:var(--ink);font:17px/1.5 system-ui,sans-serif}}"
        + A(
            "wrap",
            "max-width:1160px;margin:auto;padding:20px clamp(16px,4vw,64px) 36px",
        )
        + "nav{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid currentColor;padding-bottom:12px}nav strong{font-size:21px}nav span{font-size:13px}"
        + A(
            "hero",
            "display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:clamp(18px,4vw,60px);align-items:center;padding:34px 0",
        )
        + A("copy", "min-width:0")
        + A(
            "title",
            f"font:600 clamp(34px,5vw,{font}px)/1.01 Georgia,serif;letter-spacing:-.04em;margin:10px 0 16px",
        )
        + A("actions", "display:flex;gap:10px;align-items:stretch;margin-top:20px")
        + A(
            "link",
            "display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:0;padding:10px 14px;border:1px solid var(--ink);border-radius:9px;font:600 15px/1.2 system-ui;text-align:center;text-decoration:none;color:var(--ink);background:transparent;white-space:normal",
        )
        + rule(name("actions") + " a:first-child", "background:var(--ink);color:white")
        + A(
            "preview",
            "min-width:0;background:var(--accent);border:1px solid var(--ink);border-radius:16px;padding:16px",
        )
        + A("art", "display:block;width:100%;height:auto;aspect-ratio:2 / 1.05")
        + A(
            "cards",
            "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0 28px",
        )
        + A("card", "min-width:0;border-top:2px solid var(--ink);padding:12px 0")
        + A("form", "display:flex;gap:8px;margin:8px 0;max-width:580px")
        + A(
            "field",
            "min-width:0;flex:1;width:100%;padding:12px;border:1px solid var(--ink);border-radius:8px;font:inherit",
        )
        + "small{font-size:13px;font-weight:650}p{margin:0 0 10px}h2{font:600 26px/1.2 Georgia,serif;margin:8px 0}h3{font-size:17px;margin:2px 0}.features{margin:0 0 10px}"
    )
    # Safe rules are present for healthy components. A regression overrides a subset.
    safe = {
        "heading": A(
            "title", "white-space:normal;font-size:38px;overflow-wrap:anywhere"
        ),
        "layout": A("hero", "grid-template-columns:minmax(0,1fr);gap:14px"),
        "actions": A("actions", "flex-direction:column;align-items:stretch")
        + A("link", "min-height:44px;min-width:0"),
        "art": A("art", "width:100%;max-width:100%;min-width:0"),
        "cards": A("cards", "grid-template-columns:minmax(0,1fr)"),
        "form": A("form", "flex-direction:column")
        + A("field", "width:100%;min-width:0"),
    }
    prefix = (name("wrap") + " ") if (index + fi) % 3 != 0 else ""
    R = lambda r, style: rule(prefix + name(r), style)
    broken = {
        "heading": R(
            "title", f"font-size:{font + 8}px;white-space:nowrap;overflow-wrap:normal"
        ),
        "layout": R(
            "hero",
            f"grid-template-columns:minmax({wide}px,1fr) minmax({cols}px,1fr);gap:32px",
        ),
        "actions": R(
            "actions", "flex-direction:row;flex-wrap:nowrap;align-items:center"
        )
        + rule(
            prefix + name("actions") + " " + name("link"),
            f"min-width:{rng.choice([152, 178, 192])}px;min-height:29px;padding:4px 12px",
        ),
        "art": R("art", f"width:{width}px;min-width:{width}px;max-width:none"),
        "cards": R("cards", f"grid-template-columns:repeat(3,minmax({cols}px,1fr))"),
        "form": R("form", "flex-direction:row;flex-wrap:nowrap")
        + R("field", f"width:{wide}px;min-width:{wide}px"),
    }
    mobile = [safe[k] for k in FLAGS if k not in flags] + [broken[k] for k in flags]
    rng.shuffle(mobile)
    css += "@media(max-width:760px){" + "".join(mobile) + "}"
    metric = ["Weekly total", "New members", "Active projects", "Next release"][fi % 4]
    # Native HTML/CSS rather than a model-produced screenshot. The chart is an inline editable product preview.
    art = f'<svg {tag("art")} viewBox="0 0 360 170" role="img" aria-label="Activity preview"><rect x="1" y="1" width="358" height="168" rx="10" fill="#fffaf4" stroke="{ink}"/><text x="18" y="27" fill="{ink}" font-family="sans-serif" font-size="13">{metric}</text><path d="M20 132H340M20 96H340M20 62H340" stroke="#d8d9ce"/><path d="M20 128L72 113L104 123L149 89L186 98L222 68L261 82L307 46L341 56" fill="none" stroke="{ink}" stroke-width="5"/></svg>'
    preview = f"<aside {tag('preview')}>{art}</aside>"
    actions = f'<div {tag("actions")}><a {tag("link")} href="#pricing">{cta1}</a><a {tag("link")} href="#more">{cta2}</a></div>'
    title = f"<h1 {tag('title')}>{head}</h1>"
    copy = f"<div {tag('copy')}><small>{html.escape(industry.title())}</small>{title}<p>Meet {family}, a thoughtful way to bring your next project to life.</p>{actions}</div>"
    hero = f"<{open_hero} {tag('hero')}>{copy}{preview}</{close_hero}>"
    feature_titles = {
        "train": ["Overview", "Workflow", "Delivery"],
        "validation": ["Essentials", "Next steps", "Archive"],
        "test": ["Discover", "Organize", "Connect"],
    }[split]
    cards = "".join(
        f"<article {tag('card')}><h3>{t}</h3><p>{desc}</p></article>"
        for t, desc in zip(
            feature_titles,
            [
                "Find the details that matter.",
                "Make space for your priorities.",
                "Share the result with your team.",
            ],
        )
    )
    if split == "test":
        cards = f'<section id="more" aria-label="Highlights" {tag("cards")}>{cards}</section>'
    else:
        cards = f'<div id="more" {tag("cards")}>{cards}</div>'
    form = f'<form id="pricing" {tag("form")}><input {tag("field")} type="email" aria-label="Email address" placeholder="Email address"><button {tag("link")} type="button">Keep me posted</button></form>'
    nav = f"<nav><strong>{family}</strong><span>{industry.title()}</span></nav>"
    opening = "<main " + tag("wrap") + ">"
    body = (
        (
            opening
            + nav
            + hero
            + "<h2>What you get</h2>"
            + cards
            + "<h2>Stay in touch</h2>"
            + form
            + "</main>"
        )
        if split != "test"
        else (
            opening
            + nav
            + hero
            + '<section class="features"><h2>Inside '
            + family
            + "</h2>"
            + cards
            + "</section><footer><h2>Hear from us</h2>"
            + form
            + "</footer></main>"
        )
    )
    doc = (
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'
        + css
        + "</style><body>"
        + body
        + "</body></html>"
    )
    # Expose all acceptance conditions. The full CSS and an accurate structural representation are sufficient to author an override.
    # Keep the lengthy chart path out of the prompt; it plays no role in the CSS bug.
    structure = body.replace(
        art,
        f'<svg {tag("art")} viewBox="0 0 360 170" aria-label="Activity preview">…</svg>',
    )
    ticket = " ".join(ISSUE[f] for f in flags)
    prompt = f"{family} mobile QA ticket. {ticket} Preserve working components.\nCurrent stylesheet:\n{css}\nPage markup:\n{structure}\nReturn the appended CSS."
    return {
        "id": f"{split}-{index + 1:03d}",
        "family": family,
        "flags": list(flags),
        "selectors": c,
        "prompt": prompt,
        "html": doc,
        "ticket": ticket,
    }


def prepare():
    for split, count in [("test", 24), ("validation", 12), ("train", 225)]:
        rows = [build(split, i) for i in range(count)]
        write_rows(
            DATA / (("candidates" if split == "train" else split) + "-pages.jsonl"),
            rows,
        )
        if split == "test":
            write_rows(
                DATA / "test.jsonl",
                [{"id": r["id"], "prompt": r["prompt"]} for r in rows],
            )


if __name__ == "__main__":
    prepare()
