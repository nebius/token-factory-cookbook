import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5180';
const OUT = path.resolve('screenshots'); fs.mkdirSync(OUT, { recursive: true });
const FULL_CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: fs.existsSync(FULL_CHROME) ? FULL_CHROME : undefined, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [], tests = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const record = (name, pass, details = {}) => { tests.push({ name, pass, details }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`, JSON.stringify(details)); };
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }); };
const wait = (n = 450) => page.waitForTimeout(n);
async function slider(id, value) {
  await page.evaluate(({ id, value }) => { const input = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value)); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, { id, value });
  await wait(280);
}
async function download(buttonName) {
  await page.locator('.export-button').click();
  const promise = page.waitForEvent('download');
  await page.locator('.export-menu>button').filter({ hasText: buttonName }).click();
  const download = await promise;
  const saved = path.join(OUT, download.suggestedFilename()); await download.saveAs(saved);
  return { path: saved, size: fs.statSync(saved).size };
}
try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.hero-model .viewer-host[data-ready="true"]', { timeout: 60000 });
  await wait(700); await shot('01-landing');
  record('Landing renders real WebGL and original sample', await page.locator('.hero-model canvas').count() === 1 && await page.locator('.hero-paper img').evaluate((img) => img.complete && img.naturalWidth > 0));
  record('Desktop landing has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 }); await wait(350);
    const heroLayout = await page.evaluate(() => {
      const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const arrow = rect('.hero-arrow span'), title = rect('.model-card-head'), dimension = rect('.hero-dim-label'), model = rect('.hero-model');
      return { titleOverlap: intersects(arrow, title), dimensionOverlap: intersects(dimension, model), arrow, title, dimension, model };
    });
    record(`Hero annotations do not overlap at ${width} px`, !heroLayout.titleOverlap && !heroLayout.dimensionOverlap, heroLayout);
    if (width !== 1440) await shot(`01-landing-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 960 }); await wait(350);
  await page.getByRole('button', { name: 'Open The two-bedroom prepared demo', exact: true }).click();
  await page.waitForSelector('.canvas-wrap .viewer-host[data-ready="true"]', { timeout: 60000 }); await wait(700); await shot('02-dollhouse');
  record('Prepared demo passes all engineering checks', await page.locator('.canvas-wrap .viewer-host').getAttribute('data-checks') === 'pass');
  record('Prepared demo includes 5 rooms and 9 openings', (await page.locator('.geometry-stats').innerText()).includes('5 rooms') && (await page.locator('.geometry-stats').innerText()).includes('9 openings'));
  const furnishedCount = Number(await page.locator('.canvas-wrap .viewer-host').getAttribute('data-furniture'));
  record('Auto-furnished furniture renders in the studio', furnishedCount > 8 && (await page.locator('.furniture-legend').innerText()).includes('added by default'), { furnishedCount });
  await page.getByRole('switch', { name: 'Auto-furnish empty rooms' }).click(); await wait(250);
  record('Auto-furnish toggle removes only default items', await page.getByRole('switch', { name: 'Auto-furnish empty rooms' }).getAttribute('aria-checked') === 'false' && Number(await page.locator('.canvas-wrap .viewer-host').getAttribute('data-furniture')) === 0);
  await page.getByRole('switch', { name: 'Auto-furnish empty rooms' }).click(); await wait(250);
  const furnitureWorld = await page.evaluate(async () => {
    const { buildWorld, disposeWorld } = await import('/src/lib/world.ts');
    const { buildFurnitureItem, FURNITURE_BUILDERS } = await import('/src/lib/furniture-world.ts');
    const { buildFromModule } = await import('/src/lib/module.ts');
    const { SAMPLE_SOURCE } = await import('/src/lib/sample.ts');
    const { applyFurnishing } = await import('/src/lib/furniture.ts');
    const { FURNITURE_TYPES } = await import('/src/lib/plan.ts');
    const raw = buildFromModule(SAMPLE_SOURCE).plan;
    const world = buildWorld(applyFurnishing(raw, true), { labels: true, ceiling: true });
    let furnitureRoots = 0, meshes = 0, instanced = 0;
    world.traverse((o) => { if (o.userData.furniture) furnitureRoots++; if (o.isMesh) meshes++; if (o.isInstancedMesh) instanced++; });
    const everyBuilder = FURNITURE_TYPES.every((type) => {
      const item = buildFurnitureItem({ id: `test-${type}`, roomId: 'living', type, position: [2500, 2000], rotation: 0, source: 'auto' });
      let count = 0, instances = 0; item.traverse((o) => { if (o.isMesh) count++; if (o.isInstancedMesh) instances++; });
      return Object.keys(FURNITURE_BUILDERS).includes(type) && count > 0 && (!['dining_table', 'plant', 'tree'].includes(type) || instances > 0);
    });
    raw.rooms[0].kind = 'open'; raw.rooms[0].floor = 'paving'; raw.rooms[1].kind = 'outdoor'; raw.rooms[1].floor = 'water';
    const outdoorWorld = buildWorld(raw, { ceiling: true, labels: true });
    let openCeilings = 0, indoorCeilings = 0, recessedWater = 0, coping = 0, fittedLabels = 0;
    outdoorWorld.traverse((o) => {
      if (o.userData.ceiling && o.userData.roomId === 'living') openCeilings++;
      if (o.userData.ceiling) indoorCeilings++;
      if (o.userData.floor === 'water' && o.userData.recessed && o.position.y < 0) recessedWater++;
      if (o.name.includes('coping')) coping++;
      if (o.userData.roomLabel && o.userData.maxWidthMM > 0) fittedLabels++;
    });
    const openData = { openCeilings, indoorCeilings, recessedWater, coping, fittedLabels };
    disposeWorld(world); disposeWorld(outdoorWorld);
    return { furnitureRoots, meshes, instanced, everyBuilder, openData };
  });
  record('Every furniture builder creates low-poly geometry, with instancing for chairs and plants', furnitureWorld.everyBuilder && furnitureWorld.furnitureRoots === furnishedCount && furnitureWorld.meshes > furnitureWorld.furnitureRoots, furnitureWorld);
  record('Open/outdoor rooms have no ceiling and pools have recessed water with coping', furnitureWorld.openData.openCeilings === 0 && furnitureWorld.openData.indoorCeilings === 3 && furnitureWorld.openData.recessedWater === 1 && furnitureWorld.openData.coping === 4, furnitureWorld.openData);
  record('3D room labels carry room-fitted dimensions', furnitureWorld.openData.fittedLabels === 5, { fittedLabels: furnitureWorld.openData.fittedLabels });
  const furnitureCollision = await page.evaluate(async () => {
    const { buildFromModule } = await import('/src/lib/module.ts');
    const { SAMPLE_SOURCE } = await import('/src/lib/sample.ts');
    const { collides } = await import('/src/lib/walkthrough.ts');
    const plan = buildFromModule(SAMPLE_SOURCE).plan;
    plan.furniture = [{ id: 'collision-bed', roomId: 'living', type: 'bed_double', position: [2500, 1900], rotation: 0, source: 'sketch' }, { id: 'walkable-mat', roomId: 'living', type: 'yoga_mat', position: [4500, 3000], rotation: 0, source: 'sketch' }];
    return { bed: collides([2500, 1900], plan), bodyEdge: collides([2500, 1050], plan), clear: collides([1200, 1900], plan), mat: collides([4500, 3000], plan) };
  });
  record('Walkthrough collision blocks furniture bodies and allows mats', furnitureCollision.bed && furnitureCollision.bodyEdge && !furnitureCollision.clear && !furnitureCollision.mat, furnitureCollision);
  const timeoutProbe = await page.evaluate(async () => {
    const { runGenerator } = await import('/src/lib/builder.ts');
    const { SAMPLE_SOURCE } = await import('/src/lib/sample.ts');
    const source = SAMPLE_SOURCE.replace('const w = 10400', 'while (true) {} const w = 10400');
    const started = performance.now();
    try { await runGenerator(source); return { timeout: false }; }
    catch (error) { return { timeout: String(error.message).includes('500 ms'), elapsed: performance.now() - started }; }
  });
  record('Sandbox terminates a non-terminating generator in 500 ms', timeoutProbe.timeout && timeoutProbe.elapsed < 900, timeoutProbe);
  await page.getByRole('tab', { name: 'Plan', exact: true }).click(); await wait(); await shot('03-plan');
  const oldSvg = await page.locator('.plan-overlay img').getAttribute('src');
  record('Plan includes dimension lines and room labels', await page.locator('.plan-overlay img').evaluate((img) => img.complete && img.naturalWidth > 0));
  await page.getByRole('tab', { name: 'Dollhouse', exact: true }).click(); await wait(450);
  const label = await page.locator('.label-toggle').getAttribute('aria-pressed');
  await page.locator('.label-toggle').click(); record('Room labels toggle', label === 'true' && await page.locator('.label-toggle').getAttribute('aria-pressed') === 'false');
  await page.locator('.label-toggle').click();
  for (const suffix of ['hall_width', 'door_width', 'living_width', 'wall_height', 'window_sill']) {
    for (const end of ['min', 'max']) {
      const input = page.locator(`#param-${suffix}`); const value = await input.getAttribute(end);
      const start = Date.now(); await slider(`param-${suffix}`, Number(value));
      await page.waitForFunction(() => !document.querySelector('.local-geometry')?.textContent.includes('Rebuilding…'), { timeout: 3000 });
      const elapsed = await page.locator('.rebuild-time').innerText();
      const valid = await page.locator('.canvas-wrap .viewer-host').getAttribute('data-checks') === 'pass';
      const detail = valid ? {} : { inspector: await page.locator('.inspector').innerText() };
      record(`Slider ${suffix} ${end} rebuilds safely`, valid && Number.parseFloat(elapsed) < 200, { reportedRebuild: elapsed, browserMotionAndQueryMs: Date.now() - start, ...detail });
    }
  }
  await page.getByRole('tab', { name: 'Plan', exact: true }).click(); await wait(100);
  const newSvg = await page.locator('.plan-overlay img').getAttribute('src');
  record('Parameter edits change local plan geometry', oldSvg !== newSvg);
  await page.getByRole('tab', { name: 'Dollhouse', exact: true }).click(); await wait(300);
  const glb = await download('3D model'), glbBuffer = fs.readFileSync(glb.path), header = glbBuffer.subarray(0, 4).toString();
  const glbJson = JSON.parse(glbBuffer.subarray(20, 20 + glbBuffer.readUInt32LE(12)).toString());
  const glbFurniture = (glbJson.nodes || []).filter((node) => node.extras?.furniture);
  record('GLB export has a valid binary glTF signature', header === 'glTF' && glb.size > 10000, glb);
  record('GLB export includes catalogue furniture and provenance', glbFurniture.length > 8 && glbFurniture.every((node) => node.extras.source && node.extras.furnitureType), { furnitureNodes: glbFurniture.length });
  for (const name of ['Plan data', 'Generator module', '2D floor plan']) { const result = await download(name); record(`${name} is downloaded`, result.size > 500 && fs.existsSync(result.path), { bytes: result.size }); }
  const json = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
  record('Exported PlanSpec reflects edited slider values', json.rooms.find((r) => r.id === 'hall').polygon[1][0] > 6500);
  await page.getByRole('tab', { name: /Assumptions/ }).click(); await wait(150); await shot('04-assumptions');
  record('Assumptions include their linked editable sliders', await page.locator('.assumption-card input[type="range"]').count() === 4);
  const assumptionValues = await page.locator('.assumption-card').evaluateAll((cards) => cards.map((card) => ({ id: card.dataset.assumptionId, original: card.dataset.originalValue, current: card.dataset.currentValue, slider: card.querySelector('input[type="range"]')?.value, originalHeading: card.querySelector('.assumption-number')?.textContent, valuesShown: Boolean(card.querySelector('.assumption-values')) })));
  record('Every assumption card separates original and live values', assumptionValues.length === 4 && assumptionValues.every((card) => card.originalHeading.startsWith('ORIGINAL ASSUMPTION') && card.valuesShown && card.original && card.current === card.slider) && assumptionValues[0].original === '2700' && assumptionValues[0].current === '3400', assumptionValues);
  await slider('assumption-wall_height', 3300);
  const editedAssumption = await page.locator('[data-assumption-id="height"]').evaluate((card) => ({ original: card.dataset.originalValue, current: card.dataset.currentValue, text: card.querySelector('p').textContent }));
  record('Editing an assumption preserves its original text and value', editedAssumption.original === '2700' && editedAssumption.current === '3300' && editedAssumption.text.includes('2700 mm'), editedAssumption);
  await page.getByRole('tab', { name: 'Walkthrough', exact: true }).click(); await wait(500);
  await getWalk(); await wait(600); await shot('05-walkthrough');
  record('First-person mode starts inside the plan', await page.locator('.canvas-location').innerText() === 'EYE LEVEL · 1.6 M');
  const spawnClearance = await page.locator('.canvas-wrap .viewer-host').evaluate((host) => ({ surface: Number(host.dataset.spawnClearance), centerline: Number(host.dataset.spawnWallDistance), room: host.dataset.spawnRoom, position: host.dataset.spawn }));
  record('Walkthrough spawn is at least 900 mm from every wall', spawnClearance.surface >= 1000 && spawnClearance.centerline >= 900 && !spawnClearance.position.startsWith('6050,700'), spawnClearance);
  const walkLabels = await page.evaluate(async () => {
    const { buildWorld, disposeWorld } = await import('/src/lib/world.ts');
    const { buildFromModule } = await import('/src/lib/module.ts');
    const { SAMPLE_SOURCE } = await import('/src/lib/sample.ts');
    const world = buildWorld(buildFromModule(SAMPLE_SOURCE).plan, { labels: true, ceiling: true, walkthrough: true });
    const labels = [];
    world.traverse((object) => { if (object.isSprite && object.userData.roomLabel) labels.push({ depthTest: object.material.depthTest, depthWrite: object.material.depthWrite, sizeAttenuation: object.material.sizeAttenuation }); });
    disposeWorld(world);
    return labels;
  });
  record('Room labels are occluded by walls in walkthrough', walkLabels.length === 5 && walkLabels.every((label) => label.depthTest && !label.depthWrite && !label.sizeAttenuation) && await page.locator('.canvas-wrap .viewer-host').getAttribute('data-labels-occluded') === 'true', { labels: walkLabels });
  const visibleRoomLabels = await page.locator('.canvas-wrap .viewer-host').evaluate((host) => ({ visible: host.dataset.visibleLabel, count: Number(host.dataset.visibleLabels), room: host.dataset.spawnRoom }));
  record('First-person labels are limited to the current room', visibleRoomLabels.visible === visibleRoomLabels.room && visibleRoomLabels.count === 1, visibleRoomLabels);
  const before = await canvasPixels();
  await page.keyboard.down('w'); await wait(1200); await page.keyboard.up('w'); await wait(150);
  record('WASD changes the rendered first-person scene', before !== await canvasPixels());
  await page.keyboard.press('Escape');
  await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  await wait(250);
  record('Pointer lock releases before leaving walk mode', await page.evaluate(() => !document.pointerLockElement));
  await page.getByRole('tab', { name: 'Plan', exact: true }).click(); await wait(400);
  await page.getByRole('tab', { name: 'Dollhouse', exact: true }).click(); await wait(300);
  await page.locator('.debug-button').click(); await wait(100); await shot('06-debug');
  record('Local demo reports no fabricated model calls', (await page.locator('.debug-panel').innerText()).includes('No model calls'));
  await page.locator('.debug-head button').click();
  await page.setViewportSize({ width: 390, height: 844 }); await wait(600); await shot('07-mobile-studio');
  record('390 px studio has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('tab', { name: 'Walkthrough', exact: true }).click(); await wait(); await page.getByRole('button', { name: 'Enter your walkthrough' }).click(); await wait(500);
  record('Touch layout provides virtual joystick', await page.locator('.joystick').isVisible()); await shot('08-mobile-walk');
  await page.keyboard.press('Escape'); await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  await page.getByRole('button', { name: 'Sketch to Walkthrough home' }).click(); await wait(500); await page.screenshot({ path: path.join(OUT, '09-mobile-landing.png'), fullPage: true });
  record('390 px landing has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 960 });
  const inclusiveBounds = await page.evaluate(async () => {
    const { buildFromModule } = await import('/src/lib/module.ts');
    const { SAMPLE_SOURCE } = await import('/src/lib/sample.ts');
    return [2400, 3400].every((value) => buildFromModule(SAMPLE_SOURCE, { wall_height: value }).plan.wallHeight === value);
  });
  record('A parameter exactly at min or max is valid', inclusiveBounds);
  const source = await page.evaluate(async () => (await import('/src/lib/sample.ts')).SAMPLE_SOURCE);
  let releaseFirstReview, releaseSecondReview, reviewCount = 0;
  const firstReviewGate = new Promise((resolve) => { releaseFirstReview = resolve; });
  const secondReviewGate = new Promise((resolve) => { releaseSecondReview = resolve; });
  const repairedSource = source.replace('value: 2700, min: 2400', 'value: 3600, min: 2400').replace(', param: "wall_height"', '');
  await page.route('**/api/generate', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: repairedSource, model: 'browser-check-mock', elapsed: 0.1, tokensPerSecond: 10, usage: { completion: 1, total: 1 } }) }));
  await page.route('**/api/review', async (route) => {
    reviewCount += 1;
    await (reviewCount === 1 ? firstReviewGate : secondReviewGate);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: reviewCount === 1 ? source.replace('value: 2700, min: 2400', 'value: 2800, min: 2400') : '', verdict: reviewCount === 1 ? 'REVISE' : 'PASS', issues: [], improvements: [], model: 'browser-check-mock', elapsed: 0.1, tokensPerSecond: 10, usage: { completion: 1, total: 1 } }) });
  });
  await page.getByRole('button', { name: 'Generate walkthrough from The two-bedroom', exact: true }).click();
  await page.waitForSelector('.review-progress', { state: 'visible', timeout: 15000 });
  const firstValidVisible = await page.locator('.generation-overlay').count() === 0 && await page.locator('.canvas-wrap .viewer-host[data-checks="pass"]').count() === 1 && await page.locator('.studio').getAttribute('data-active-version') === '1';
  record('v1 opens as soon as it validates while review continues', firstValidVisible);
  await shot('10-first-valid-background-review');
  await page.getByRole('tab', { name: /Checks/ }).click();
  const repairNotes = await page.locator('[data-testid="repair-notes"]').innerText();
  record('Local parameter and assumption repairs are visible on v1', repairNotes.includes('clamped 3600 to 3400') && repairNotes.includes('linked missing param to wall_height') && repairNotes.includes('no model retry'), { repairNotes });
  await page.getByRole('tab', { name: 'Walkthrough', exact: true }).click();
  releaseFirstReview();
  await page.waitForFunction(() => document.querySelectorAll('.version-button').length === 2);
  await page.waitForSelector('.new-version-notice', { state: 'visible' });
  record('A revised v2 does not interrupt the v1 walkthrough', await page.locator('.studio').getAttribute('data-active-version') === '1' && await page.getByRole('tab', { name: 'Walkthrough', exact: true }).getAttribute('aria-selected') === 'true');
  await shot('11-new-version-available');
  releaseSecondReview();
  await page.waitForSelector('.review-progress', { state: 'hidden', timeout: 15000 });
  await page.unroute('**/api/generate'); await page.unroute('**/api/review');
  record('Browser has no runtime or WebGL errors', errors.length === 0, { errors });
} catch (error) {
  record('Completed full browser flow', false, { error: String(error) });
  try { await shot('browser-error'); } catch {}
} finally { await browser.close(); }
const failures = tests.filter((t) => !t.pass);
fs.writeFileSync(path.join(OUT, 'browser-results.json'), JSON.stringify({ tests, errors, date: new Date().toISOString() }, null, 2));
console.log(`Browser: ${tests.length - failures.length}/${tests.length} passed.`);
process.exit(failures.length ? 1 : 0);

async function canvasPixels() { return page.locator('.canvas-wrap canvas').evaluate((c) => c.toDataURL()); }
async function getWalk() { await page.getByRole('button', { name: 'Enter your walkthrough' }).click(); }
