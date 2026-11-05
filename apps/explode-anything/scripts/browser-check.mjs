import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.SCREENSHOTS ?? 'screenshots';
fs.mkdirSync(OUT, { recursive: true });
const CHROME_FULL = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BROWSER_BIN = fs.existsSync(CHROME_FULL) ? CHROME_FULL : undefined;

const browser = await chromium.launch({
  executablePath: BROWSER_BIN,
  headless: true,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox',
    '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-webgl',
    '--disable-web-security', '--allow-file-access-from-files', '--ignore-certificate-errors',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push({ type: 'pageerror', message: String(error) }));
page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', text: message.text() }); });
await page.addInitScript(() => {
  window.__errors = [];
  window.addEventListener('error', event => window.__errors.push({ type: 'error', message: event.message }));
  window.addEventListener('unhandledrejection', event => window.__errors.push({ type: 'unhandled', reason: String(event.reason) }));
});

const tests = [];
function record(name, pass, details = {}) {
  tests.push({ name, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`, JSON.stringify(details));
}
const wait = ms => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__EA?.state ?? null);
const shot = name => page.screenshot({ path: path.join(OUT, `${name}.png`), type: 'png' });
async function slider(id, value) {
  await page.evaluate(({ id, value }) => {
    const input = document.getElementById(id);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}
async function preset(name, duration = 1300) {
  await page.evaluate(name => document.querySelector(`.btn-preset[data-preset="${name}"]`).click(), name);
  await wait(duration);
  const activePreset = await page.evaluate(() => document.querySelector('.btn-preset.active')?.getAttribute('data-preset'));
  record(`Camera preset ${name} is active`, (await state())?.preset === name && activePreset === name, { preset: (await state())?.preset, domPreset: activePreset });
}
async function reset(duration = 1000) {
  await page.evaluate(() => document.getElementById('resetBtn').click());
  await wait(duration);
}

try {
  console.log('Opening:', BASE);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.__EA), undefined, { timeout: 45000 });
  await wait(1800);
  const initialTransforms = await page.evaluate(() => window.__EA.transforms());
  let current = await state();
  record('App boots with a WebGL canvas', Boolean(current) && await page.evaluate(() => !!document.getElementById('scene')?.getContext('webgl2')), current);
  record('Registry contains 36 meaningful parts', current?.parts === 36, { parts: current?.parts });
  record('Initial state is assembled Hero', current?.assembly === 0 && current?.preset === 'hero', current);
  record('Desktop canvas fills its stage width', current?.canvas.width === 1168, current?.canvas);
  await shot('01-assembled');

  const header1440 = await page.evaluate(() => {
    const actions = document.getElementById('headerActions').getBoundingClientRect();
    const intro = document.querySelector('.intro');
    const introStyle = getComputedStyle(intro);
    return { right: actions.right, viewport: innerWidth, text: intro.textContent.trim(), overflow: introStyle.overflow, bottom: actions.bottom };
  });
  record('1440px header contains Play showcase', header1440.right <= header1440.viewport && header1440.text === 'Pull it apart. Discover what makes the image.', header1440);
  await preset('front');
  await shot('15-front');
  await preset('rear');
  await shot('16-rear');
  await reset();

  await page.evaluate(() => document.getElementById('explodeBtn').click());
  await wait(2400);
  current = await state();
  record('Explode reaches 100 and fits overview', current?.assembly === 100 && current?.preset === 'exploded', current);
  record('Every component reaches its fully exploded stage', current?.assembledError === 36, { stageTotal: current?.assembledError });
  await shot('02-exploded');

  // Reversal must restore exactly the original persistent-object transforms.
  await reset();
  const restoredTransforms = await page.evaluate(() => window.__EA.transforms());
  const maxReturnError = initialTransforms.reduce((maximum, original, index) => {
    const restored = restoredTransforms[index];
    const positionError = original.position.reduce((sum, value, i) => sum + Math.abs(value - restored.position[i]), 0);
    const quaternionError = original.quaternion.reduce((sum, value, i) => sum + Math.abs(value - restored.quaternion[i]), 0);
    return Math.max(maximum, positionError + quaternionError);
  }, 0);
  record('Explode/reset restores transforms without drift', maxReturnError < 1e-7, { maxReturnError });

  await slider('assemblyInput', 55);
  await wait(500);
  record('Mid slider value is 55%', (await state())?.assembly === 55);
  await shot('03-half-exploded');

  // Dragging during playback immediately hands control back to the visitor.
  await page.evaluate(() => document.getElementById('explodeBtn').click());
  await wait(150);
  await slider('assemblyInput', 37.5);
  current = await state();
  record('Slider cancels playback immediately', current?.assembly === 37.5 && current?.playing === false, current);

  await slider('assemblyInput', 0);
  await wait(1100);
  await page.evaluate(() => document.querySelector('.part-item[data-id="frontShell"]').click());
  record('Selection from parts list', (await state())?.selected === 'frontShell');
  await shot('04-select-front-shell');
  await page.evaluate(() => document.getElementById('clearSelBtn').click());
  record('Clear selection works', (await state())?.selected === null);

  const canvasRect = await page.locator('#scene').boundingBox();
  await page.mouse.click(canvasRect.x + canvasRect.width * 0.36, canvasRect.y + canvasRect.height * 0.53);
  current = await state();
  record('Canvas click selects a 3D part', current?.selected !== null, { selected: current?.selected });
  await page.evaluate(() => document.getElementById('clearSelBtn').click());
  await page.mouse.move(canvasRect.x + canvasRect.width * 0.6, canvasRect.y + canvasRect.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(canvasRect.x + canvasRect.width * 0.68, canvasRect.y + canvasRect.height * 0.56, { steps: 8 });
  await page.mouse.up();
  record('Orbit drag does not select a part', (await state())?.selected === null);

  await reset();
  await preset('lens');
  await shot('05-lens-detail');
  await slider('apertureInput', 8);
  await wait(250);
  record('Aperture updates model and DOM', (await state())?.aperture === 'f/8.0' && await page.textContent('#apertureDisplay') === 'f/8.0');
  await slider('apertureInput', 16);
  current = await state();
  record('Aperture reaches f/16 and animates its opening', current?.aperture === 'f/16.0' && current?.irisAnimating && current?.visualFNumber < 16, { target: current?.aperture, visualFNumber: current?.visualFNumber });
  await slider('apertureInput', 1.8);
  record('Aperture reverses to f/1.8', (await state())?.aperture === 'f/1.8');

  for (const [mode, file] of [['technical', '18-technical'], ['xray', '19-xray'], ['materials', '06-materials-restored']]) {
    await page.evaluate(mode => document.querySelector(`.btn-mode[data-mode="${mode}"]`).click(), mode);
    await wait(350);
    const domMode = await page.evaluate(() => document.querySelector('.btn-mode.active')?.getAttribute('data-mode'));
    record(`Display mode ${mode}`, (await state())?.mode === mode && domMode === mode, { domMode });
    await shot(file);
  }
  await shot('07-go-back-hero');

  // Isolate the iris in the real exploded scene and capture both aperture extremes.
  await page.evaluate(() => window.__EA.setAssembly(100));
  await preset('lens');
  await shot('24-lens-detail-exploded');
  await page.evaluate(() => {
    window.__EA.select('aperture');
    document.getElementById('focusSelected').click();
  });
  await wait(1200);
  record('Focus part isolates one persistent component', (await state())?.visibleParts === 1, { visibleParts: (await state())?.visibleParts });
  await slider('apertureInput', 1.8);
  await shot('13-aperture-open');
  await slider('apertureInput', 16);
  await shot('14-aperture-closed');
  await page.evaluate(() => document.getElementById('focusSelected').click());
  await wait(1100);
  record('Show all restores all 36 components', (await state())?.visibleParts === 36, { visibleParts: (await state())?.visibleParts });

  await reset();
  await page.evaluate(() => document.getElementById('sensorFocusBtn').click());
  await wait(1200);
  record('Sensor preset isolates sensor PCB and shutter', (await state())?.visibleParts === 3, { visibleParts: (await state())?.visibleParts });
  await page.evaluate(() => document.getElementById('shutterBtn').click());
  await page.waitForFunction(() => window.__EA?.state.sensorExposed === true, undefined, { timeout: 4000 });
  current = await state();
  record('Shutter briefly exposes sensor', current?.sensorExposed === true, current);
  await shot('08-shutter-released');
  await page.waitForFunction(() => window.__EA?.state.sensorExposed === false, undefined, { timeout: 5000 });
  record('Shutter closes after its dwell', (await state())?.sensorExposed === false);
  await page.evaluate(() => document.getElementById('lightRayToggle').click());
  await wait(350);
  record('Schematic light-path toggle enables', await page.locator('#lightRayToggle').isChecked());
  await shot('23-light-path');

  await page.evaluate(() => document.getElementById('showcaseBtn').click());
  await wait(850);
  record('Showcase starts on request', (await state())?.showcase === true);
  await shot('09-showcase-start');
  await page.evaluate(() => document.getElementById('cancelShowcase').click());
  record('Showcase cancellation works', (await state())?.showcase === false);
  await reset();
  await page.evaluate(() => document.getElementById('showcaseBtn').click());
  await wait(11600);
  await shot('25-showcase-lens');
  await wait(9100);
  current = await state();
  record('Showcase completes assembled at Hero', current?.showcase === false && current?.assembly === 0 && current?.preset === 'hero', current);

  await page.evaluate(() => document.getElementById('presentBtn').click());
  await wait(250);
  record('Presentation hides secondary inspector', await page.locator('#inspector').isHidden());
  await shot('21-presentation');
  await page.evaluate(() => document.getElementById('exitPresent').click());
  record('Presentation Exit restores inspector', await page.locator('#inspector').isVisible());

  await reset();
  await page.setViewportSize({ width: 390, height: 844 });
  await wait(700);
  current = await state();
  const mobileLayout = await page.evaluate(() => {
    const canvas = document.getElementById('scene').getBoundingClientRect();
    const bar = document.getElementById('assemblyBar').getBoundingClientRect();
    return { canvasWidth: canvas.width, viewport: innerWidth, barBottom: bar.bottom, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  record('390px mobile canvas is full width', mobileLayout.canvasWidth === mobileLayout.viewport, mobileLayout);
  record('Mobile assembly bar is on screen', mobileLayout.barBottom <= mobileLayout.height + 1 && mobileLayout.barBottom > mobileLayout.height - 150, mobileLayout);
  record('Mobile has no horizontal overflow', !mobileLayout.overflow);
  record('Mobile inspector starts collapsed', await page.locator('#inspector').isHidden());
  await shot('10-mobile');
  await page.evaluate(() => document.getElementById('mobilePanelToggle').click());
  await wait(250);
  record('Mobile details panel expands', await page.locator('#inspector').isVisible());
  await shot('20-mobile-details');
  await slider('assemblyInput', 25);
  record('Mobile assembly slider remains usable', (await state())?.assembly === 25);
  await page.evaluate(() => document.getElementById('mobilePanelToggle').click());

  await page.setViewportSize({ width: 1280, height: 800 });
  await reset();
  const header1280 = await page.evaluate(() => {
    const actions = document.getElementById('headerActions').getBoundingClientRect();
    const intro = document.querySelector('.intro').getBoundingClientRect();
    const bar = document.getElementById('assemblyBar').getBoundingClientRect();
    return { right: actions.right, viewport: innerWidth, introWidth: intro.width, barBottom: bar.bottom, height: innerHeight };
  });
  record('1280px header and assembly bar are contained', header1280.right <= header1280.viewport && header1280.introWidth > 200 && header1280.barBottom <= header1280.height + 1, header1280);
  await shot('17-hero-1280');

  record('No page runtime errors', (await page.evaluate(() => window.__errors)).length === 0, { errors: await page.evaluate(() => window.__errors) });
  record('No browser console errors', errors.length === 0, { errors });

  const fallback = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return original.call(this, type, ...args);
    };
  });
  await fallback.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await fallback.waitForSelector('#webglFallback:not([hidden])', { timeout: 15000 });
  await fallback.screenshot({ path: path.join(OUT, '22-webgl-fallback.png'), type: 'png' });
  record('WebGL failure shows a visible fallback', await fallback.locator('#webglFallback').isVisible());
  await fallback.close();
} finally {
  await browser.close();
}

const failures = tests.filter(test => !test.pass);
console.log('\n==========');
console.log(`Total: ${tests.length} | Passed: ${tests.length - failures.length} | Failed: ${failures.length}`);
failures.forEach(failure => console.log('-', failure.name, JSON.stringify(failure.details)));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ tests, errors }, null, 2));
process.exit(failures.length ? 1 : 0);
