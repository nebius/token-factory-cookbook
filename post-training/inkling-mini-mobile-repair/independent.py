"""Independent transfer fixtures for held-out layouts authored separately from pages.py."""

import re
from pages import DATA, ISSUE, write_rows, sha

BRANDS = [
    (
        "Bracken",
        "Field guides by post",
        "Book a delivery",
        "See an issue",
        "A seasonal field guide for the curious walker.",
        "A pressed fern",
        "A coast walk",
        "Last light",
        "Willow",
    ),
    (
        "Loomline",
        "Give old cloth a new story",
        "Book a fitting",
        "View the studio",
        "Join a mending workshop and repair the pieces you love.",
        "Indigo thread",
        "Patch workshop",
        "Studio hours",
        "Atelier",
    ),
    (
        "Pavilion",
        "Seats for the summer",
        "Browse the season",
        "Reserve a seat",
        "Local theatre under the trees, all summer long.",
        "Opening night",
        "The players",
        "Garden stage",
        "Ticket",
    ),
    (
        "Canopy",
        "Weather for the long walk",
        "Get a forecast",
        "Save a route",
        "Forecast cards for paths beyond the city.",
        "Wind",
        "Rainfall",
        "Visibility",
        "Forecast",
    ),
    (
        "Dovetail",
        "Make space for good tools",
        "Explore benches",
        "Visit the shop",
        "Furniture that holds what you need for the next project.",
        "Oak bench",
        "Maple shelf",
        "Beech peg",
        "Workbench",
    ),
    (
        "Tracework",
        "A record worth keeping",
        "Browse sessions",
        "Book studio time",
        "Press live recordings into short-run records.",
        "Listening booth",
        "Session tape",
        "Vinyl press",
        "Studio",
    ),
    (
        "Sunroom",
        "Bring the outside in",
        "Browse seedlings",
        "Find a class",
        "Herbs and wildflowers grown for small spaces.",
        "Basil",
        "Lemon thyme",
        "Sweet alyssum",
        "Growing kit",
    ),
    (
        "Nightjar",
        "Find a darker sky",
        "Reserve a night",
        "Browse the sky map",
        "Guided stargazing far from the streetlights.",
        "This month",
        "The horizon",
        "The moon",
        "Observatory",
    ),
]
NAMES = [
    "container",
    "intro",
    "message",
    "headline",
    "choices",
    "control",
    "display",
    "graphic",
    "offers",
    "item",
    "signup",
    "address",
]
ROLES = [
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
COMBOS = [
    ("heading", "actions", "cards"),
    ("layout", "art", "form"),
    ("actions", "cards", "form"),
    ("heading", "layout", "art"),
    ("heading", "form", "cards"),
    ("layout", "actions", "art"),
    ("art", "actions", "heading"),
    ("cards", "layout", "form"),
]


def build(i):
    b, h, ca, cb, desc, t1, t2, t3, tag = BRANDS[i]
    prefix = b.lower()
    c = {role: f"{prefix}__{name}" for role, name in zip(ROLES, NAMES)}
    sel = lambda k: "." + c[k]
    attr = lambda k: 'class="' + c[k] + '"'
    dom = f"""<header class="top"><a href="#home">{b}</a><span>{tag}</span></header><main {attr("wrap")}>
<section aria-labelledby="offer" {attr("hero")}><header {attr("copy")}><p class="eyebrow">{tag} / Current edition</p><h1 id="offer" {attr("title")}>{h}</h1><p>{desc}</p><div {attr("actions")}><a {attr("link")} href="#join">{ca}</a><a {attr("link")} href="#list">{cb}</a></div></header><figure {attr("preview")}><svg {attr("art")} viewBox="0 0 260 112" aria-label="Sample from {tag}"><rect width="260" height="112" rx="4" fill="#e7e9d7"/><circle cx="196" cy="28" r="18" fill="#dd785b"/><path d="M0 82 52 46 99 79 148 25 241 104H0Z" fill="#587663"/><path d="M72 62 136 41 196 77 260 55V112H72Z" fill="#293e39"/></svg><figcaption>{tag} collection</figcaption></figure></section>
<section id="list"><h2>Inside this edition</h2><div {attr("cards")}>{"".join(f"<section {attr("card")}><strong>{n}</strong><p>{s}</p></section>" for n, s in zip([t1, t2, t3], ["A closer look at the details.", "An invitation to explore.", "A note from our editors."]))}</div></section>
<footer id="join"><h2>Notes from {b}</h2><form {attr("form")}><input {attr("field")} placeholder="Email address" aria-label="Email address"><button {attr("link")} type="button">Sign me up</button></form></footer></main>"""
    cream, ink, accent = [
        ("#fff9eb", "#272c26", "#e4d39c"),
        ("#f6ede9", "#392a40", "#dbc0d6"),
        ("#eaf0f4", "#232d3a", "#bacfd4"),
        ("#eef1e1", "#303a23", "#c5d697"),
    ][i % 4]
    sheet = f"""*{{box-sizing:border-box}}body{{margin:0;color:{ink};background:{cream};font:16px/1.5 Arial,sans-serif}}.top{{display:flex;justify-content:space-between;border-bottom:2px solid;padding:14px 5vw}}.top a{{font:700 24px Georgia;color:inherit;text-decoration:none}}.top span,.eyebrow,figcaption{{font-size:13px;letter-spacing:.04em}}main{{width:min(90%,1080px);margin:auto}}h2{{font:500 25px Georgia}}figure{{margin:0}}p{{margin:8px 0 14px}}
{sel("hero")}{{display:flex;align-items:center;gap:32px;padding:24px 0}}{sel("copy")}{{flex:1;min-width:0}}{sel("title")}{{font:600 clamp(30px,6vw,64px)/1.07 Georgia,serif;margin:4px 0 12px}}{sel("actions")}{{display:grid;grid-auto-flow:column;grid-auto-columns:max-content;gap:8px}}{sel("link")}{{display:grid;place-content:center;min-height:45px;padding:8px 14px;background:{ink};color:white;border:1px solid {ink};text-decoration:none;text-align:center;font:600 15px/1.25 Arial;border-radius:6px}}
{sel("preview")}{{flex:1;min-width:0;padding:12px;background:{accent};border-radius:9px}}{sel("art")}{{display:block;width:100%;height:auto}}{sel("cards")}{{display:flex;gap:14px}}{sel("card")}{{flex:1;border:1px solid {ink};border-radius:6px;padding:12px}}{sel("form")}{{display:grid;grid-template-columns:1fr auto;gap:8px;max-width:620px;margin-bottom:28px}}{sel("field")}{{font:inherit;min-width:0;min-height:44px;padding:8px 10px;width:100%}}
@media (max-width: 760px){{{sel("hero")}{{flex-direction:column;align-items:stretch;gap:16px}}{sel("title")}{{white-space:normal;overflow-wrap:anywhere;font-size:37px}}{sel("actions")}{{grid-auto-flow:row;grid-auto-columns:1fr;grid-template-columns:1fr}}{sel("cards")}{{flex-direction:column}}{sel("form")}{{grid-template-columns:1fr}}}}"""
    # Cascaded author-specific regressions, using different layout mechanisms from training cases.
    scoped = lambda k: ("main " if i % 2 else sel("wrap") + " ") + sel(k)
    bugs = {
        "heading": scoped("title")
        + "{white-space:nowrap;font-size:68px;overflow-wrap:normal}",
        "actions": scoped("actions")
        + "{grid-template-columns:repeat(2,max-content);grid-auto-flow:column}"
        + scoped("link")
        + "{min-height:28px}",
        "cards": scoped("cards")
        + "{flex-flow:row nowrap}"
        + scoped("card")
        + "{min-width:220px}",
        "form": scoped("form") + "{grid-template-columns:minmax(300px,1fr) 148px}",
        "art": scoped("art") + "{min-inline-size:460px;inline-size:460px}",
        "layout": scoped("hero")
        + "{flex-flow:row nowrap;align-items:center}"
        + scoped("copy")
        + "{min-inline-size:320px}",
    }
    flags = COMBOS[i]
    sheet += (
        "@media screen and (max-width:760px){" + "".join(bugs[k] for k in flags) + "}"
    )
    doc = (
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'
        + sheet
        + "</style><body>"
        + dom
        + "</body></html>"
    )
    structure = re.sub(r"(<svg [^>]*>).*?</svg>", r"\1…</svg>", dom, flags=re.S)
    ticket = " ".join(ISSUE[f] for f in flags)
    return dict(
        id=f"external-{i + 1:02d}",
        family=b,
        flags=list(flags),
        selectors=c,
        html=doc,
        ticket=ticket,
        prompt=f"{b} layout regression. {ticket} Leave the desktop design intact.\nExisting CSS:\n{sheet}\nMarkup:\n{structure}\nReturn the appended CSS.",
    )


if __name__ == "__main__":
    rows = [build(i) for i in range(len(BRANDS))]
    write_rows(DATA / "external-pages.jsonl", rows)
    write_rows(
        DATA / "external.jsonl", [{"id": r["id"], "prompt": r["prompt"]} for r in rows]
    )
    print(sha(DATA / "external.jsonl"))
