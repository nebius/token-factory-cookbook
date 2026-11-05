// A real-usage demo of Codetrail, driven in a browser against the running app:
//   paste a repo link → what will be read and what it costs → the live read → the first tour → finding on the map
//   and the map as text → a question → a suggested follow-up → the docs → their slides → the receipt → a Research
//   answer, with its plan and rounds.
//
//   pnpm demo:test     # run the flow and check it, with screenshots; nothing is recorded
//   pnpm demo:record   # the same flow, recorded to docs/demo.mp4 and docs/demo.gif
//   pnpm demo:record --assemble   # rebuild the video from the last recording's saved frames (needs DEMO_WORK)
//
// DEMO_REPO and DEMO_QUESTION pick what to read and ask (a repo nobody has read yet shows the live build; one
// already read replays for free). Waiting for the model is sped up in the video; everything else plays at real
// speed. Set CHROME_PATH to use a specific Chrome/Chromium and DEMO_URL if the app isn't on localhost:3000.
// DEMO_THEME=light records the light theme; DEMO_OUT sets the output path without extension (default docs/demo);
// DEMO_RESEARCH is the stored Research answer to end on (a path on the app; empty to skip).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Locator } from "playwright-core";

const RECORD = process.argv.includes("--record");
const ASSEMBLE_ONLY = process.argv.includes("--assemble");
const URL = process.env.DEMO_URL || "http://localhost:3000";
const REPO = process.env.DEMO_REPO || "honojs/hono";
const QUESTION = process.env.DEMO_QUESTION || "How does Hono pick the route for a request?";
const W = 1600;
const H = 900; // headless Chrome caps the page area at ~907px tall
// Nothing on screen for longer than this is dead time, and is cut to this.
const MAX_HOLD = 2.5;
const THEME = process.env.DEMO_THEME === "light" ? "light" : "dark";
const OUT = process.env.DEMO_OUT || "docs/demo";
const OUT_MP4 = `${OUT}.mp4`;
const OUT_GIF = `${OUT}.gif`;
const RESEARCH = process.env.DEMO_RESEARCH ?? "/lukeed/polka?answer=d24287f5297b";
const work = process.env.DEMO_WORK
  ? (ASSEMBLE_ONLY || fs.rmSync(process.env.DEMO_WORK, { recursive: true, force: true }), fs.mkdirSync(process.env.DEMO_WORK, { recursive: true }), process.env.DEMO_WORK)
  : fs.mkdtempSync(path.join(os.tmpdir(), "codetrail-demo-"));

type Frame = { file: string; t: number };
/** A stretch spent waiting for the model: [from, to, seconds it should take in the video]. */
type Wait = [number, number, number];
if (ASSEMBLE_ONLY) {
  const { frames, waits } = JSON.parse(fs.readFileSync(`${work}/timeline.json`, "utf8"));
  assemble(frames, waits);
  process.exit(0);
}

// --- browser, cursor, recording ---
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: THEME });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const dot = Object.assign(document.createElement("div"), { id: "demo-cursor" });
    dot.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;margin:-4px 0 0 -4px;z-index:2147483647;pointer-events:none;transition:transform .08s;";
    dot.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#f4f0e6" stroke="#08090b" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => ((dot.style.left = `${e.clientX}px`), (dot.style.top = `${e.clientY}px`)), true);
    addEventListener("mousedown", () => (dot.style.transform = "scale(.8)"), true);
    addEventListener("mouseup", () => (dot.style.transform = ""), true);
  });
});

const frames: Frame[] = [];
const waits: Wait[] = [];
const now = () => Date.now() / 1000;
if (RECORD) {
  const cdp = await ctx.newCDPSession(page);
  let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const file = `${work}/f${String(n++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    // Chrome's frame timestamps use another clock than the wait markers, so stamp frames on arrival.
    frames.push({ file, t: now() });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W, maxHeight: H });
}

const pause = (ms: number) => page.waitForTimeout(ms);
/** Runs `until` and marks the time it took as a wait that plays in `seconds` in the video. */
async function waitFor(seconds: number, until: () => Promise<unknown>) {
  const from = now();
  await until();
  waits.push([from, now(), seconds]);
}
let mouse = { x: W / 2, y: H / 2 };
async function moveTo(l: Locator) {
  await l.scrollIntoViewIfNeeded();
  const b = (await l.boundingBox())!;
  const to = { x: b.x + Math.min(b.width / 2, 120), y: b.y + b.height / 2 };
  await page.mouse.move(to.x, to.y, { steps: Math.max(8, Math.round(Math.hypot(to.x - mouse.x, to.y - mouse.y) / 25)) });
  mouse = to;
}
async function click(l: Locator, after = 500) {
  await moveTo(l);
  await pause(180);
  await page.mouse.click(mouse.x, mouse.y);
  await pause(after);
}
/** Types like a person: uneven gaps between keys, a little longer after spaces. */
async function typeHuman(text: string) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await pause(45 + Math.random() * 65 + (ch === " " ? 60 : 0));
  }
}
async function wheel(over: Locator, by: number, ms = 900) {
  await moveTo(over);
  await page.mouse.wheel(0, by);
  await pause(ms);
}
const checks: [string, boolean][] = [];
const check = (name: string, ok: boolean) => (checks.push([name, ok]), console.log(`${ok ? "✓" : "✗"} ${name}`));
const shot = async (name: string) => !RECORD && page.screenshot({ path: `${work}/${name}.png` });
const right = page.locator("section[aria-label='Current step and code']");

// --- 1. paste the link ---
await page.goto(URL, { waitUntil: "networkidle" });
await page.mouse.move(mouse.x, mouse.y);
await pause(1400);
await click(page.getByLabel("Paste any GitHub link"), 300);
await typeHuman(`https://github.com/${REPO}`);
await pause(600);
await page.keyboard.press("Enter");
await page.waitForURL(new RegExp(`/${REPO}`), { timeout: 60_000 });

// --- 2. what will be read, and what it costs (only for a repo nobody has read yet) ---
const readButton = page.getByRole("button", { name: /read the repo/i });
await waitFor(1.5, () => Promise.race([readButton.waitFor({ timeout: 240_000 }), page.locator(".code-view .line").first().waitFor({ timeout: 240_000 })]));
const fresh = await readButton.isVisible();
if (fresh) {
  await pause(1600);
  await moveTo(page.getByText(/to send/).first());
  await pause(1800);
  await moveTo(page.getByText(/Map \+ main tour/).first());
  await pause(1600);
  await shot("1-ready");
  await click(readButton, 0);
  // --- 3. the live read: thinking (compressed hard), then the map writing itself (still sped up, but visible) ---
  await waitFor(2.5, () => page.locator("g[data-id]").first().waitFor({ timeout: 600_000 }));
  await waitFor(7, () => page.locator(".code-view .line").first().waitFor({ timeout: 600_000 }));
  check("the live read finished with a map and a tour", true);
}
await pause(1500);
await shot("2-map");

// --- 4. the first tour: let one step play, then step by hand; a look at the file graph ---
await page.waitForTimeout(5500);
await moveTo(right.locator("h2").first());
for (let i = 0; i < 3; i++) {
  await page.keyboard.press("ArrowRight");
  await pause(2300);
}
check("the tour steps through checked lines", (await page.locator(".code-view .line.hl").count()) > 0);
await shot("3-tour");
await click(page.getByRole("tab", { name: /files/i }), 2400);
await click(page.getByRole("tab", { name: /modules/i }), 900);

// --- 4b. find on the map, and the map as text ---
await click(page.getByRole("tab", { name: /architecture/i }), 900);
await click(page.locator("#map-find"), 300);
await typeHuman("router");
await pause(1400);
await page.keyboard.press("Enter");
await pause(1600);
check("find lights up matches on the map", (await page.locator("#map-find").inputValue()) === "router");
await page.locator("#map-find").fill("");
await click(page.getByRole("button", { name: "List", exact: true }), 1800);
await wheel(page.locator("#map-panel"), 360, 1100);
check("the map reads as a list", await page.getByRole("button", { name: "List", exact: true }).getAttribute("aria-pressed").then((v) => v === "true"));
await shot("3b-list");
await click(page.getByRole("button", { name: "List", exact: true }), 900);

// --- 5. ask a question ---
const ask = page.getByLabel("Ask how something works");
await click(ask, 300);
await typeHuman(QUESTION);
await pause(700);
await page.keyboard.press("Enter");
await waitFor(2, () => page.getByText("Reading the question…").waitFor({ state: "detached", timeout: 600_000 }).catch(() => {}));
await waitFor(4, () => page.getByText("Ask a follow-up").first().waitFor({ timeout: 600_000 }));
await pause(1200);
check("the answer arrived", true);
await wheel(right.locator("h2").first(), 380, 1100);
await wheel(right.locator("h2").first(), 380, 1100);
const ref = right.locator("button:has-text('lines checked')").first();
check("the answer has checked code references", (await ref.count()) > 0);
if (await ref.count()) await click(ref, 2600);
await shot("4-answer");

// --- 6. a follow-up the model suggested ---
const chip = page.locator("ul[aria-label='Suggested follow-ups'] button").first();
check("the answer suggests follow-ups", (await chip.count()) > 0);
if (await chip.count()) {
  await click(chip, 0);
  await waitFor(5, () => page.locator("nav[aria-label='Conversation']").waitFor({ timeout: 600_000 }));
  await pause(1500);
  await wheel(right.locator("h2").first(), 360, 1200);
  check("the follow-up joined a conversation", await page.locator("nav[aria-label='Conversation']").isVisible());
  await shot("5-follow-up");
}

// --- 7. the docs ---
const docs = page.getByRole("button", { name: /(Write|Read) the docs/ });
await click(docs, 0);
await waitFor(3, () => page.locator("article[aria-labelledby='doc-title']").waitFor({ timeout: 600_000 }));
await pause(1600);
const pages = page.locator("nav[aria-label='Doc pages'] button");
if ((await pages.count()) > 1) await click(pages.nth(1), 1400);
await wheel(page.locator("#doc-title"), 420, 1300);
check("the docs opened", await page.locator("#doc-title").isVisible());
await shot("6-docs");

// --- 7b. the docs as slides ---
const slides = page.getByRole("link", { name: "Slides" });
if (await slides.count()) {
  await click(slides, 0);
  await page.waitForURL(/\/slides/, { timeout: 60_000 });
  await pause(1800);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowRight");
    await pause(1700);
  }
  check("the slides step through", /#4$/.test(page.url()));
  await shot("6b-slides");
  await page.goBack();
  await page.locator("#doc-title").waitFor({ timeout: 60_000 }).catch(() => {});
  await pause(1200);
}

// --- 8. the receipt ---
await click(page.locator("header button").filter({ hasText: /calls/ }).first(), 3800);
await shot("7-receipt");
await page.keyboard.press("Escape");
await pause(1200);

// --- 9. a Research answer: the plan and the rounds behind it ---
if (RESEARCH) {
  await page.goto(`${URL}${RESEARCH}`, { waitUntil: "networkidle" });
  await waitFor(2, () => page.getByText(/How it was researched/).waitFor({ timeout: 120_000 }));
  await pause(1500);
  await wheel(right.locator("h2").first(), 900, 1600);
  await click(page.getByText("Plan", { exact: true }).first(), 1800);
  await click(page.getByText("Round 1", { exact: true }).first(), 2200);
  await wheel(right.locator("h2").first(), 420, 1300);
  check("the Research answer shows its plan and rounds", await page.getByText(/How it was researched · \d+ rounds?/).isVisible());
  await shot("8-research");
}

await browser.close();
console.log(`errors in the page: ${errors.length ? errors.slice(0, 5).join(" | ") : "none"}`);

if (RECORD) {
  fs.writeFileSync(`${work}/timeline.json`, JSON.stringify({ frames, waits }));
  assemble(frames, waits);
} else console.log(`screenshots: ${work}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);

function assemble(frames: Frame[], waits: Wait[]) {
  const factorAt = (t: number) => {
    const w = waits.find(([a, b]) => t >= a && t < b);
    return w ? Math.max(1, (w[1] - w[0]) / w[2]) : 1;
  };
  // Sped-up stretches arrive as many frames per video frame; keep one and let it carry the time of the ones it
  // replaces, instead of giving every frame a minimum duration (which would undo the speed-up).
  const lines: string[] = [];
  let total = 0;
  let carried = 0;
  frames.forEach((f, i) => {
    carried += Math.min(((frames[i + 1]?.t ?? f.t + 1.5) - f.t) / factorAt(f.t), MAX_HOLD);
    if (carried < 1 / 30 && i < frames.length - 1) return;
    total += carried;
    lines.push(`file '${f.file}'`, `duration ${carried.toFixed(4)}`);
    carried = 0;
  });
  lines.push(`file '${frames.at(-1)!.file}'`);
  fs.writeFileSync(`${work}/frames.txt`, lines.join("\n"));
  fs.mkdirSync(path.dirname(OUT_MP4), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${work}/frames.txt`, "-vf", `fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=08090b,format=yuv420p`, "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", OUT_MP4]);
  const gif = (seconds?: number) =>
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...(seconds ? ["-t", String(seconds)] : []), "-i", OUT_MP4, "-vf", "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", OUT_GIF]);
  gif();
  // A GitHub README shows GIFs up to 10 MB; keep the preview well under that.
  if (fs.statSync(OUT_GIF).size > 8 * 1024 * 1024) gif(25);
  const mb = (f: string) => (fs.statSync(f).size / 1024 / 1024).toFixed(1);
  console.log(`video: ${OUT_MP4} (${total.toFixed(1)} s, ${mb(OUT_MP4)} MB, ${frames.length} frames) · gif: ${OUT_GIF} (${mb(OUT_GIF)} MB) · waits: ${waits.map(([a, b, s]) => `${(b - a).toFixed(0)}s→${s}s`).join(", ")}`);
}
