// The README's screenshots, in the dark and light themes, from repos already read on the running app. Model
// routes are blocked, so nothing is spent.
//
//   pnpm screenshots [names]     # names: tour,open,calls,docs,pr,answer,ready (default: all)
//
// Writes docs/screenshots/<name>.png (dark) and <name>-light.png. Set SHOTS_URL if the app isn't on localhost:3000,
// and CHROME_PATH to use a specific Chrome/Chromium. Needs honojs/hono, Studio1-OSS/AgentC, lukeed/polka (with PR
// #198 and answer 7ef0dc7c1c0e) and lukeed/klona (prepared, not read) on the instance.
import { chromium, type Page } from "playwright-core";

const BASE = process.env.SHOTS_URL || "http://localhost:3000";
const OUT = "docs/screenshots";
const only = process.argv[2]?.split(",").filter(Boolean);
const want = (n: string) => !only?.length || only.includes(n);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const errors: string[] = [];

async function shoot(scheme: "dark" | "light", name: string, url: string, act?: (p: Page) => Promise<void>, wait = 3000) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  await page.route(/\/api\/(ask|tour|pull|docs|atlas|layers)(\/stream)?$/, (r) => (r.request().method() === "POST" ? r.abort() : r.continue()));
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  await act?.(page);
  await page.screenshot({ path: `${OUT}/${name}${scheme === "light" ? "-light" : ""}.png` });
  await context.close();
}

for (const scheme of ["dark", "light"] as const) {
  if (want("tour"))
    await shoot(scheme, "tour", "/honojs/hono", async (p) => {
      for (let i = 0; i < 2; i++) {
        await p.keyboard.press("ArrowRight");
        await p.waitForTimeout(400);
      }
      await p.waitForTimeout(1200);
    });
  if (want("open"))
    await shoot(scheme, "architecture-open", "/Studio1-OSS/AgentC?open=agent-runtime", async (p) => {
      await p.getByRole("button", { name: "Fit to screen" }).click();
      await p.waitForTimeout(800);
      // A link with import lines behind it, from the opened module.
      const links = p.locator('[aria-label^="Link:"]');
      for (let i = 0; i < (await links.count()); i++) {
        await links.nth(i).dispatchEvent("click");
        await p.waitForTimeout(300);
        if (await p.getByText(/imports? behind it/i).isVisible().catch(() => false)) break;
      }
      await p.waitForTimeout(600);
    });
  if (want("calls"))
    await shoot(scheme, "calls", "/honojs/hono", async (p) => {
      await p.getByRole("tab", { name: "calls" }).click();
      await p.waitForTimeout(800);
      await p.getByLabel(/File to show the calls of/).fill("src/hono-base.ts");
      await p.waitForTimeout(400);
      await p.keyboard.press("Enter");
      await p.waitForTimeout(3500);
    });
  if (want("docs"))
    await shoot(scheme, "docs", "/lukeed/polka?doc=core", async (p) => {
      await p.locator("figure").scrollIntoViewIfNeeded();
      await p.waitForTimeout(800);
    });
  if (want("pr"))
    await shoot(scheme, "pr-tour", "/lukeed/polka/pull/198", async (p) => {
      await p.keyboard.press("ArrowRight");
      await p.waitForTimeout(1500);
    });
  if (want("answer")) await shoot(scheme, "answer", "/lukeed/polka?answer=7ef0dc7c1c0e");
  if (want("ready"))
    await shoot(
      scheme,
      "before-reading",
      "/lukeed/klona",
      async (p) => {
        await p.getByRole("button", { name: /Read only part of the repo/ }).click();
        await p.waitForTimeout(400);
        await p.evaluate(() => window.scrollTo(0, 0));
      },
      5000,
    );
}

await browser.close();
console.log(errors.join("\n") || "Screenshots written to docs/screenshots, no page errors.");
