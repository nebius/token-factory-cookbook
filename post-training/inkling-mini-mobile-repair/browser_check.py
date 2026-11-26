"""Test a CSS patch by rendering the untouched page and patched page in Chromium."""

import argparse, asyncio, json, re, os
from pathlib import Path
from playwright.async_api import async_playwright
from pages import ROOT, DATA, read_rows, write_rows

WORK = ROOT / "work"
OUT = Path(os.environ.get("REPAIR_RESULTS_DIR", ROOT / "results"))
MOBILE = (320, 375, 430)
DESKTOP = (1024, 1280)
JS = r"""(names) => {
const el=k=>document.querySelector('.'+names[k]);
const rect=e=>e.getBoundingClientRect();
const W=innerWidth;
const preserved=[...document.querySelectorAll('body,main,nav,h1,h2,h3,p,small,a,form,input,button,svg,article,aside,footer')];
const signature=preserved.map(e=>{
 const q=rect(e),s=getComputedStyle(e);
 return [q.x,q.y,q.width,q.height,s.fontSize,s.lineHeight,s.color,s.backgroundColor,s.display,s.visibility,s.opacity,s.transform,e.textContent];
});
const visible=e=>{
 const b=rect(e);
 if(b.width<1||b.height<1||b.right>W+1||b.left<-.9)return false;
 for(let a=e;a;a=a.parentElement){
   const s=getComputedStyle(a); if(s.display==='none'||s.visibility==='hidden'||+s.opacity<.3)return false;
   if(s.overflowX==='hidden'||s.overflowX==='clip'){
     const ap=rect(a);if(b.right>ap.right+1||b.left<ap.left-1)return false;
   }
 }
 return true;
};
const textFits=e=> {
 const range=document.createRange();range.selectNodeContents(e);
 const cb=rect(e);
 return [...range.getClientRects()].every(b=>b.left>=cb.left-1&&b.right<=cb.right+1&&b.left>=-1&&b.right<=W+1);
};
const within=(e,p)=>{const b=rect(e),r=rect(p);return b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1};
const column=els=>els.every((e,i)=> !i||rect(e).top >= rect(els[i-1]).bottom-1);
const actions=[...el('actions').querySelectorAll('a')],cards=[...el('cards').children],fields=[...el('form').children];
const wide=(e,p)=>rect(e).width>=.88*p.clientWidth;
const actionOK=e=>visible(e)&&textFits(e)&&rect(e).height>=40&&parseFloat(getComputedStyle(e).fontSize)>=13;
const keep=[el('title'),el('art'),...actions,...cards,...fields];
const checks={
  viewport:document.documentElement.scrollWidth<=W+1,
  visible:keep.every(visible)&&[...document.querySelectorAll('h2,h3,small,article p')].every(e=>visible(e)&&textFits(e)),
  heading:visible(el('title'))&&textFits(el('title'))&&parseFloat(getComputedStyle(el('title')).fontSize)>=26,
  actions:column(actions)&&actions.every(e=>wide(e,el('actions'))&&actionOK(e)),
  layout:column([el('copy'),el('preview')])&&wide(el('copy'),el('hero'))&&wide(el('preview'),el('hero')),
  cards:column(cards)&&cards.every(e=>wide(e,el('cards'))&&visible(e)),
  art:visible(el('art'))&&within(el('art'),el('preview'))&&rect(el('art')).width>=125&&rect(el('art')).height>=50,
  form:column(fields)&&fields.every(e=>wide(e,el('form'))&&visible(e)&&rect(e).height>=40)
};
return {signature,checks};
}"""


def css_patch(raw):
    raw = raw.strip()
    fence = re.fullmatch(r"```(?:css)?\s*(.*?)\s*```", raw, re.S | re.I)
    if fence:
        raw = fence[1].strip()
    wrap = re.fullmatch(r"<style[^>]*>(.*?)</style>", raw, re.S | re.I)
    if wrap:
        raw = wrap[1].strip()
    if len(raw) > 40000 or re.search(
        r"@import|\burl\s*\(|</?script|</?iframe", raw, re.I
    ):
        return "", False
    return raw, True


def browser_binary():
    return next(
        (
            str(p)
            for p in (
                Path("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
                Path("/usr/bin/chromium"),
                Path("/usr/bin/google-chrome"),
            )
            if p.exists()
        ),
        None,
    )


async def measure(page, row, raw):
    sheet, allowed = css_patch(raw)
    await page.set_content(row["html"], wait_until="domcontentloaded")
    desktop = {}
    for w in DESKTOP:
        await page.set_viewport_size({"width": w, "height": 850})
        desktop[w] = (await page.evaluate(JS, row["selectors"]))["signature"]
    if sheet:
        await page.add_style_tag(content=sheet)
    retained = True
    for w in reversed(DESKTOP):
        await page.set_viewport_size({"width": w, "height": 850})
        actual = (await page.evaluate(JS, row["selectors"]))["signature"]
        retained &= actual == desktop[w]
    mobile = {}
    for w in MOBILE:
        await page.set_viewport_size({"width": w, "height": 850})
        mobile[str(w)] = (await page.evaluate(JS, row["selectors"]))["checks"]
    checks = {
        key: all(v[key] for v in mobile.values()) for key in next(iter(mobile.values()))
    }
    return {
        "id": row["id"],
        "eligible_css": allowed,
        "desktop_unchanged": retained,
        "mobile": mobile,
        "checks": checks,
        "pass": bool(allowed and retained and all(checks.values())),
        "reported_defects_fixed": sum(checks[k] for k in row["flags"]),
        "reported_defects": len(row["flags"]),
    }


async def batch(items, destination, workers=5):
    destination.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            executable_path=browser_binary(), headless=True
        )
        context = await browser.new_context(offline=True)
        q = asyncio.Queue()
        for row, raw in items:
            q.put_nowait((row, raw))

        async def worker():
            page = await context.new_page()
            while not q.empty():
                try:
                    row, raw = q.get_nowait()
                except asyncio.QueueEmpty:
                    break
                f = destination / (row["id"] + ".json")
                result = await measure(page, row, raw)
                f.write_text(json.dumps(result))
            await page.close()

        await asyncio.gather(*(worker() for _ in range(workers)))
        await browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "arm",
        choices=[
            "broken",
            "teacher",
            "base",
            "tuned",
            "base-external",
            "tuned-external",
            "broken-external",
        ],
    )
    args = ap.parse_args()
    if args.arm == "teacher":
        rows = read_rows(DATA / "candidates-pages.jsonl") + read_rows(
            DATA / "validation-pages.jsonl"
        )
        items = [
            (
                r,
                json.loads((WORK / "teacher" / (r["id"] + ".json")).read_text())[
                    "response"
                ],
            )
            for r in rows
            if (WORK / "teacher" / (r["id"] + ".json")).is_file()
        ]
    else:
        rows = read_rows(
            DATA
            / (
                "external-pages.jsonl"
                if args.arm.endswith("-external")
                else "test-pages.jsonl"
            )
        )
        if args.arm.startswith("broken"):
            items = [(r, "") for r in rows]
        else:
            f = OUT / (("adapted" if args.arm == "tuned" else args.arm) + ".jsonl")
            outputs = read_rows(f)
            assert [r["id"] for r in rows] == [r["id"] for r in outputs]
            items = [(r, out["raw"]) for r, out in zip(rows, outputs)]
    OUT.mkdir(exist_ok=True, parents=True)
    dest = (WORK if args.arm == "teacher" else OUT) / "checks" / args.arm
    asyncio.run(batch(items, dest))
    results = [json.loads((dest / (r["id"] + ".json")).read_text()) for r, _ in items]
    if args.arm != "teacher":
        write_rows(OUT / (args.arm + "-checked.jsonl"), results)
    print(
        args.arm,
        len(results),
        "full passes",
        sum(r["pass"] for r in results),
        flush=True,
    )


if __name__ == "__main__":
    main()
