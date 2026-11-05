// Accessibility scan: axe-core's WCAG 2.2 A and AA rules on the main pages, in the dark and light themes, against
// the running app. Model routes are blocked, so nothing is spent; pass repos that are already read.
//
//   pnpm a11y [owner/repo ...]     # default: lukeed/polka
//
// Set A11Y_URL if the app isn't on localhost:3000, and CHROME_PATH to use a specific Chrome/Chromium.
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright-core";

const BASE = process.env.A11Y_URL || "http://localhost:3000";
const repos = process.argv.slice(2).length ? process.argv.slice(2) : ["lukeed/polka"];
const pages = ["/", "/guide", "/browse", "/data", ...repos.flatMap((r) => [`/${r}`, `/${r}/slides`])];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
let serious = 0;
for (const scheme of ["dark", "light"] as const) {
  for (const path of pages) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await context.newPage();
    await page.route(/\/api\/(ask|tour|pull|docs|atlas|layers)(\/stream)?$/, (r) => (r.request().method() === "POST" ? r.abort() : r.continue()));
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical").length;
    serious += bad;
    console.log(`${scheme.padEnd(5)} ${path}: ${violations.length ? `${violations.length} issues (${bad} serious or critical)` : "no issues"}`);
    for (const v of violations) console.log(`        [${v.impact}] ${v.id}: ${v.help}, ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(" ")}`);
    await context.close();
  }
}
await browser.close();
process.exit(serious ? 1 : 0);
