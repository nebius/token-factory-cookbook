import * as THREE from "three";

/* ════════════════════════════════════════════════════════════════
   Image → 3D · Kimi K3.1 Pro on Nebius Token Factory
   ════════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const els = {
  drop: $("drop"), fileInput: $("fileInput"), dropEmpty: $("dropEmpty"), preview: $("preview"), clearImg: $("clearImg"),
  palette: $("palette"), styles: $("styles"), notes: $("notes"), generateBtn: $("generateBtn"), ctaNote: $("ctaNote"),
  history: $("history"), clearHistory: $("clearHistory"),
  stage: $("stage"), previewCanvas: $("previewCanvas"), frame: $("sceneFrame"), emptyState: $("emptyState"),
  progress: $("progress"), codeTail: $("codeTail"), mElapsed: $("mElapsed"), mTokens: $("mTokens"), mRate: $("mRate"), stopBtn: $("stopBtn"),
  errorCard: $("errorCard"), errorTitle: $("errorTitle"), errorMsg: $("errorMsg"), fixBtn: $("fixBtn"), dismissErr: $("dismissErr"),
  orbitHint: $("orbitHint"), codeView: $("codeView"), thinkView: $("thinkView"), codeCount: $("codeCount"),
  reloadBtn: $("reloadBtn"), openBtn: $("openBtn"), downloadBtn: $("downloadBtn"), fullBtn: $("fullBtn"),
  refineForm: $("refineForm"), refineInput: $("refineInput"), refineBtn: $("refineBtn"),
  keyBtn: $("keyBtn"), keyLabel: $("keyLabel"), modelName: $("modelName"),
  keyModal: $("keyModal"), keyInput: $("keyInput"), toggleKey: $("toggleKey"), modelInput: $("modelInput"), baseInput: $("baseInput"),
  rememberKey: $("rememberKey"), verifyRow: $("verifyRow"), removeKey: $("removeKey"), verifyKey: $("verifyKey"), saveKey: $("saveKey"),
  toast: $("toast"),
};

const state = {
  server: { hasServerKey: false, model: "moonshotai/Kimi-K3.1-Pro", baseUrl: "" },
  byok: { key: "", model: "", baseUrl: "", remember: true },
  image: null,          // { dataUrl, thumb, palette, w, h }
  style: "faithful",
  busy: false,
  abort: null,
  tab: "scene",
  scene: null,          // { id, code, image, style, notes, brief, refinements[] }
  lastError: null,
};

/* ───────────────────────── BYOK settings ───────────────────────── */
const BYOK_KEY = "i3d.byok";
function loadByok() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(BYOK_KEY);
      if (raw) { Object.assign(state.byok, JSON.parse(raw)); state.byok.remember = store === localStorage; return; }
    } catch { /* storage unavailable */ }
  }
}
function saveByok() {
  try { localStorage.removeItem(BYOK_KEY); sessionStorage.removeItem(BYOK_KEY); } catch { /* ignore */ }
  const { key, model, baseUrl, remember } = state.byok;
  if (!key && !model && !baseUrl) return;
  try { (remember ? localStorage : sessionStorage).setItem(BYOK_KEY, JSON.stringify({ key, model, baseUrl })); } catch { /* ignore */ }
}
const activeModel = () => state.byok.model || state.server.model;
function apiHeaders() {
  const h = { "content-type": "application/json" };
  if (state.byok.key) h["x-nebius-key"] = state.byok.key;
  if (state.byok.baseUrl) h["x-nebius-base-url"] = state.byok.baseUrl;
  return h;
}
const hasAnyKey = () => Boolean(state.byok.key || state.server.hasServerKey);

function renderKeyStatus() {
  els.keyBtn.classList.remove("active", "warn");
  if (state.byok.key) { els.keyLabel.textContent = `Your key · ••••${state.byok.key.slice(-4)}`; els.keyBtn.classList.add("active"); }
  else if (state.server.hasServerKey) { els.keyLabel.textContent = "Bring your own key"; }
  else { els.keyLabel.textContent = "Add API key"; els.keyBtn.classList.add("warn"); }
  els.modelName.textContent = activeModel();
  updateCta();
}

function openKeyModal() {
  els.keyInput.value = state.byok.key;
  els.modelInput.value = state.byok.model;
  els.modelInput.placeholder = state.server.model;
  els.baseInput.value = state.byok.baseUrl;
  els.baseInput.placeholder = state.server.baseUrl || "https://api.tokenfactory.nebius.com/v1";
  els.rememberKey.checked = state.byok.remember;
  els.verifyRow.hidden = true;
  els.keyInput.type = "password"; els.toggleKey.textContent = "Show";
  els.keyModal.showModal();
  setTimeout(() => els.keyInput.focus(), 30);
}
function readKeyForm() {
  return { key: els.keyInput.value.trim(), model: els.modelInput.value.trim(), baseUrl: els.baseInput.value.trim(), remember: els.rememberKey.checked };
}

els.keyBtn.addEventListener("click", openKeyModal);
els.toggleKey.addEventListener("click", () => {
  const show = els.keyInput.type === "password";
  els.keyInput.type = show ? "text" : "password";
  els.toggleKey.textContent = show ? "Hide" : "Show";
});
els.saveKey.addEventListener("click", () => {
  Object.assign(state.byok, readKeyForm());
  saveByok(); renderKeyStatus(); els.keyModal.close();
  toast(state.byok.key ? "Using your Token Factory key" : "Settings saved", "ok");
});
els.removeKey.addEventListener("click", () => {
  state.byok = { key: "", model: "", baseUrl: "", remember: true };
  saveByok(); renderKeyStatus(); els.keyModal.close();
  toast(state.server.hasServerKey ? "Key removed — using the app's key" : "Key removed");
});
els.verifyKey.addEventListener("click", async () => {
  const f = readKeyForm();
  els.verifyRow.hidden = false; els.verifyRow.className = "verify-row"; els.verifyRow.textContent = "Checking key with Token Factory…";
  const headers = {};
  if (f.key) headers["x-nebius-key"] = f.key;
  if (f.baseUrl) headers["x-nebius-base-url"] = f.baseUrl;
  try {
    const r = await fetch("/api/verify", { headers });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Key check failed");
    const want = f.model || state.server.model;
    const found = j.models.includes(want);
    els.verifyRow.className = "verify-row ok";
    els.verifyRow.textContent = `✓ Key works · ${j.total} models available` +
      (found ? ` · ${want} ✓` : j.models.length ? `\nKimi models on this key: ${j.models.join(", ")}` : `\n(${want} was not listed — it may still work)`);
  } catch (e) {
    els.verifyRow.className = "verify-row bad";
    els.verifyRow.textContent = `✕ ${e.message}`;
  }
});

/* ───────────────────────── Image intake ───────────────────────── */
async function loadImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return toast("That file isn't an image", "bad");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not decode image")); i.src = url; });
    setImage(processImage(img));
  } catch (e) { toast(e.message, "bad"); }
  finally { URL.revokeObjectURL(url); }
}

function processImage(img) {
  const max = 1024;
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = c.toDataURL("image/jpeg", 0.88);
  return { dataUrl, thumb: makeThumb(c, 96), palette: extractPalette(ctx, w, h), w, h, canvas: c };
}

function makeThumb(src, size) {
  const t = document.createElement("canvas"); t.width = t.height = size;
  const s = Math.max(size / src.width, size / src.height);
  t.getContext("2d").drawImage(src, (size - src.width * s) / 2, (size - src.height * s) / 2, src.width * s, src.height * s);
  return t.toDataURL("image/jpeg", 0.8);
}

// Quick colour quantisation: 4-bit buckets, then pick distinct heavy hitters.
function extractPalette(ctx, w, h) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 12000)));
  const { data } = ctx.getImageData(0, 0, w, h);
  const buckets = new Map();
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n]);
  const picked = [];
  for (const c of sorted) {
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 48)) picked.push(c);
    if (picked.length === 6) break;
  }
  return picked.map((c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""));
}

function setImage(image) {
  state.image = image;
  if (image) {
    els.preview.src = image.dataUrl; els.preview.hidden = false; els.dropEmpty.hidden = true; els.clearImg.hidden = false;
    els.drop.classList.add("has-image");
    els.palette.innerHTML = image.palette.map((hex) => `<span style="background:${hex}" data-hex="${hex}"></span>`).join("");
    els.palette.hidden = false;
    if (!state.busy && !state.scene) { preview3d.sculpt(image, false); els.emptyState.hidden = true; }
  } else {
    els.preview.hidden = true; els.preview.removeAttribute("src"); els.dropEmpty.hidden = false; els.clearImg.hidden = true;
    els.drop.classList.remove("has-image"); els.palette.hidden = true;
    if (!state.busy && !state.scene) { preview3d.idle(); els.emptyState.hidden = Boolean(state.image); }
  }
  updateCta();
}

els.fileInput.addEventListener("change", (e) => { loadImageFile(e.target.files[0]); e.target.value = ""; });
els.clearImg.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setImage(null); });
els.drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); } });
["dragenter", "dragover"].forEach((t) => els.drop.addEventListener(t, (e) => { e.preventDefault(); els.drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => els.drop.addEventListener(t, () => els.drop.classList.remove("over")));
els.drop.addEventListener("drop", (e) => { e.preventDefault(); loadImageFile(e.dataTransfer.files[0]); });
// Allow dropping anywhere on the page too.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { if (!els.drop.contains(e.target)) { e.preventDefault(); loadImageFile(e.dataTransfer.files[0]); } });
document.addEventListener("paste", (e) => {
  if (e.target.matches("input, textarea")) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) loadImageFile(item.getAsFile());
});

/* ───────────────────────── Style picker ───────────────────────── */
els.styles.addEventListener("click", (e) => {
  const btn = e.target.closest(".style"); if (!btn) return;
  state.style = btn.dataset.style;
  els.styles.querySelectorAll(".style").forEach((b) => { const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
});

function updateCta() {
  const ready = Boolean(state.image) && !state.busy;
  els.generateBtn.disabled = !ready;
  els.generateBtn.classList.toggle("busy", state.busy);
  els.generateBtn.querySelector(".btn-label").textContent = state.busy ? "Kimi is building…" : state.scene ? "Generate new scene" : "Generate 3D scene";
  els.ctaNote.textContent = state.busy ? "Kimi reasons before it builds — expect around 5–10 minutes."
    : !state.image ? "Add an image to start."
    : !hasAnyKey() ? "You'll be asked for a Token Factory API key."
    : `Runs on ${activeModel()}`;
  const canRefine = Boolean(state.scene?.code) && !state.busy;
  els.refineInput.disabled = !canRefine;
  els.refineBtn.disabled = !canRefine;
  for (const b of [els.reloadBtn, els.openBtn, els.downloadBtn]) b.disabled = !state.scene?.code || state.busy;
}

/* ───────────────────────── Prompting ───────────────────────── */
const THREE_VERSION = "0.160.0";
const IMPORT_MAP = `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"}}</script>`;

const SYSTEM_PROMPT = `You are Kimi, a world-class 3D artist and creative technologist. You turn a single reference image into a stunning, interactive, real-time 3D scene written with Three.js r160.

OUTPUT FORMAT
Reply with exactly one complete, self-contained HTML document inside a single \`\`\`html code block. No text before or after the code block.

TECHNICAL RULES (must follow)
1. Load Three.js ONLY with this import map, copied verbatim into <head>:
${IMPORT_MAP}
   Then put all code in one <script type="module">. Import from "three" and "three/addons/..." (e.g. "three/addons/controls/OrbitControls.js", "three/addons/geometries/RoundedBoxGeometry.js", "three/addons/environments/RoomEnvironment.js", "three/addons/postprocessing/EffectComposer.js"). No other libraries.
2. No external assets of any kind: no texture/model/font/image URLs, no fetch. Build everything procedurally — primitives, LatheGeometry, ExtrudeGeometry from Shapes, TubeGeometry along curves, displaced BufferGeometry, InstancedMesh, CanvasTexture drawn with the 2D canvas API, vertex colours, custom shaders.
3. Full-window canvas: html,body{margin:0;height:100%;overflow:hidden}. Handle window resize. renderer = new THREE.WebGLRenderer({antialias:true}); setPixelRatio(Math.min(devicePixelRatio,2)); outputColorSpace = THREE.SRGBColorSpace; toneMapping = THREE.ACESFilmicToneMapping; soft shadows enabled.
4. OrbitControls with enableDamping, autoRotate (autoRotateSpeed ≈ 0.6), sensible min/maxDistance and maxPolarAngle so the camera never goes under the ground. Frame the camera so the whole subject is visible and fills ~70% of the view.
5. Use only current r160 APIs: BufferGeometry (never Geometry), THREE.SRGBColorSpace (never sRGBEncoding), CapsuleGeometry exists. Declare every variable before use. Code must run with zero console errors.
6. Keep it efficient (60 fps on a laptop) and compact: under ~550 lines. No UI, buttons, text overlays or loading screens.

ART DIRECTION
- First study the image: identify the subject(s), silhouette, proportions, pose, camera angle, materials, palette, lighting direction and mood.
- Recreate it as a recognisable 3D scene: the main subject must be instantly identifiable when compared side by side with the photo. Model the important distinctive details — this is what makes it impressive. Build complex forms from many well-placed parts organised in named THREE.Group hierarchies.
- Use the image's actual colours (a sampled palette is provided). Physically plausible materials (MeshStandardMaterial / MeshPhysicalMaterial with fitting roughness, metalness, clearcoat, transmission).
- Light it like the photo: key light matching the photo's light direction with shadows, a rim/fill light, and ambient image-based light via PMREMGenerator + RoomEnvironment. Background colour or gradient and fog that echo the photo's backdrop.
- Ground the subject (floor, terrain, table, water or plinth as appropriate) with contact shadows.
- Add tasteful life: subtle idle animation fitting the subject (swaying, floating, breathing, drifting particles, flickering lights, moving water).`;

const STYLE_PROMPTS = {
  faithful: "STYLE: Faithful. Recreate the image as faithfully as possible: realistic proportions, materials and colour, matching the photo's lighting and atmosphere.",
  diorama: "STYLE: Miniature diorama. Present the subject as a charming tabletop diorama on a rounded plinth/base with a cut-away ground slice, little environmental details from the image around it, warm soft lighting and a gentle tilt-shift feel.",
  lowpoly: "STYLE: Low-poly. Faceted geometry with low segment counts and flatShading: true, bold flat colours from the palette, crisp shadows — like a polished low-poly game asset.",
  voxel: "STYLE: Voxel art. Build everything from unit cubes using InstancedMesh with per-instance colours (setColorAt), like a 3D pixel-art sculpture on a voxel grid up to ~48³. Derive the voxel shapes carefully from the image's silhouette and colour regions.",
  toon: "STYLE: Soft toy. Rounded, squishy, cute proportions — RoundedBoxGeometry, capsules, spheres, slightly pastel version of the palette, soft matte clay-like materials, gentle bouncy idle animation.",
  neon: "STYLE: Neon night. Reinterpret the scene after dark: deep dark background, emissive materials in the palette's colours, glowing edges and particles, with UnrealBloomPass via EffectComposer + RenderPass + OutputPass for glow.",
};

function buildBrief({ style, notes, image }) {
  return [
    "Turn this reference image into an interactive 3D Three.js scene.",
    STYLE_PROMPTS[style],
    `Sampled palette from the image (most dominant first): ${image.palette.join(", ")}.`,
    `Image aspect ratio: ${image.w}×${image.h}.`,
    notes ? `Extra direction from the user: ${notes}` : "",
    "Return the complete HTML document in one ```html block.",
  ].filter(Boolean).join("\n\n");
}

function firstUserMessage(scene) {
  return { role: "user", content: [
    { type: "text", text: scene.brief },
    { type: "image_url", image_url: { url: scene.image.dataUrl } },
  ] };
}

/* ───────────────────────── Streaming ───────────────────────── */
async function streamChat(messages, { onReasoning, onContent, signal }) {
  const res = await fetch("/api/chat", {
    method: "POST", headers: apiHeaders(), signal,
    body: JSON.stringify({ model: activeModel(), messages, max_tokens: 32000, temperature: 0.6 }),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", finish = null, usage = null, inThink = false;

  const route = (text) => {
    // Some deployments inline reasoning as <think>…</think> inside content.
    while (text) {
      if (inThink) {
        const end = text.indexOf("</think>");
        if (end < 0) { onReasoning(text); return; }
        onReasoning(text.slice(0, end)); text = text.slice(end + 8); inThink = false;
      } else {
        const start = text.indexOf("<think>");
        if (start < 0) { onContent(text); return; }
        if (start > 0) onContent(text.slice(0, start));
        text = text.slice(start + 7); inThink = true;
      }
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      if (j.usage) usage = j.usage;
      const ch = j.choices?.[0];
      if (!ch) continue;
      const d = ch.delta || {};
      const r = d.reasoning_content ?? d.reasoning;
      if (r) onReasoning(r);
      if (d.content) route(d.content);
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  return { finish, usage };
}

function extractHtml(text) {
  const closed = text.match(/```(?:html|HTML)?[ \t]*\n([\s\S]*?)\n?```/);
  if (closed && /<(html|!doctype|script|body)/i.test(closed[1])) return { code: closed[1].trim(), complete: true };
  const open = text.match(/```(?:html|HTML)?[ \t]*\n([\s\S]*)$/);
  let code = open ? open[1] : text;
  const i = code.search(/<!doctype html|<html/i);
  if (i < 0) return { code: "", complete: false };
  code = code.slice(i).trim();
  return { code, complete: /<\/html>\s*$/i.test(code) };
}

/* ───────────────────────── Generate / refine / fix ───────────────────────── */
els.generateBtn.addEventListener("click", () => startNew());
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !els.keyModal.open) {
    if (document.activeElement === els.refineInput) return;
    e.preventDefault(); if (!els.generateBtn.disabled) startNew();
  }
});

function startNew() {
  if (!state.image || state.busy) return;
  if (!hasAnyKey()) { openKeyModal(); toast("Add your Token Factory API key to generate", "bad"); return; }
  const notes = els.notes.value.trim();
  const scene = {
    id: (crypto.randomUUID?.() || String(Date.now())), code: "", image: state.image, style: state.style, notes,
    brief: buildBrief({ style: state.style, notes, image: state.image }), refinements: [],
  };
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, firstUserMessage(scene)];
  run({ messages, scene, label: "build" });
}

function followUp(instruction, kind, note = instruction) {
  const prev = state.scene;
  if (!prev?.code || state.busy) return;
  if (!hasAnyKey()) { openKeyModal(); return; }
  const history = prev.refinements.length ? `Earlier refinements already applied: ${prev.refinements.map((r) => `“${r}”`).join("; ")}.\n\n` : "";
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    firstUserMessage(prev),
    { role: "assistant", content: "```html\n" + prev.code + "\n```" },
    { role: "user", content: `${history}${instruction}\n\nKeep everything that already works, follow all the technical rules, and return the COMPLETE updated HTML document in one \`\`\`html block.` },
  ];
  const scene = { ...prev, id: (crypto.randomUUID?.() || String(Date.now())), code: "", saved: false, truncated: false, refinements: kind === "refine" ? [...prev.refinements, note] : prev.refinements };
  run({ messages, scene, label: kind, fallback: prev });
}

els.refineForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.refineInput.value.trim(); if (!text) return;
  els.refineInput.value = "";
  followUp(`Please update the scene: ${text}`, "refine", text);
});

async function run({ messages, scene, label, fallback }) {
  state.busy = true; state.abort = new AbortController();
  hideError(); updateCta();
  showFrame(false);
  preview3d.sculpt(scene.image, true);
  setTab("scene");
  els.emptyState.hidden = true;
  els.progress.hidden = false; els.stopBtn.hidden = false;
  els.codeView.textContent = ""; els.thinkView.textContent = ""; els.codeCount.textContent = "";
  setPhase("read");

  const t0 = performance.now();
  let tokens = 0, firstTok = 0, content = "", reasoning = "", raf = 0;
  const timer = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    els.mElapsed.textContent = `${s.toFixed(1)}s`;
    els.mTokens.textContent = `${tokens.toLocaleString()} tokens`;
    if (firstTok) els.mRate.textContent = `${(tokens / Math.max(0.1, (performance.now() - firstTok) / 1000)).toFixed(0)} tok/s`;
  }, 100);
  const paint = () => {
    raf = 0;
    const lines = (content || reasoning).split("\n").slice(-3).join("\n");
    els.codeTail.innerHTML = escapeHtml(lines) + '<span class="caret"></span>';
    if (state.tab === "code") { els.codeView.textContent = content; stickToBottom(els.codeView); }
    if (state.tab === "thinking") { els.thinkView.textContent = reasoning; stickToBottom(els.thinkView); }
    els.codeCount.textContent = content ? `${content.split("\n").length}` : "";
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

  try {
    const { finish } = await streamChat(messages, {
      signal: state.abort.signal,
      onReasoning: (t) => { if (!firstTok) firstTok = performance.now(); tokens++; reasoning += t; if (!content) setPhase("think"); schedule(); },
      onContent: (t) => { if (!firstTok) firstTok = performance.now(); tokens++; content += t; setPhase("build"); schedule(); },
    });
    paint();
    const { code, complete } = extractHtml(content);
    if (!code) throw Object.assign(new Error("Kimi replied without an HTML scene. Try again, or add more direction."), { retry: true });
    scene.code = code;
    scene.truncated = !complete || finish === "length";
    state.scene = scene;
    setPhase("render");
    renderScene(scene.code);
    els.codeView.innerHTML = highlight(scene.code);
    els.codeCount.textContent = `${scene.code.split("\n").length}`;
    els.thinkView.textContent = reasoning;
    if (scene.truncated) setTimeout(() => {
      if (state.scene === scene && !state.lastError) showError("The scene was cut off", "Kimi ran out of output tokens before finishing the file, so parts may be missing.", { fix: "Ask Kimi to finish it" });
    }, 2500);
  } catch (e) {
    if (e.name === "AbortError") {
      toast("Generation stopped");
      restoreAfterFailure(fallback);
    } else {
      restoreAfterFailure(fallback);
      const auth = e.status === 401 || e.status === 403 || /api key/i.test(e.message);
      showError(auth ? "API key problem" : "Generation failed", e.message, auth ? { action: "Update key", onAction: openKeyModal } : { action: "Try again", onAction: () => run({ messages, scene, label, fallback }) });
    }
  } finally {
    clearInterval(timer);
    if (raf) cancelAnimationFrame(raf);
    state.busy = false; state.abort = null;
    if (!els.frame.classList.contains("loading")) els.progress.hidden = true;
    else els.stopBtn.hidden = true;
    updateCta();
  }
}

function restoreAfterFailure(fallback) {
  if (fallback?.code) { state.scene = fallback; renderScene(fallback.code); els.codeView.innerHTML = highlight(fallback.code); }
  else if (!state.scene) { showFrame(false); state.image ? preview3d.sculpt(state.image, false) : preview3d.idle(); els.emptyState.hidden = Boolean(state.image); }
}

els.stopBtn.addEventListener("click", () => state.abort?.abort());

function setPhase(p) {
  const order = ["read", "think", "build", "render"];
  const idx = order.indexOf(p);
  els.progress.querySelectorAll(".phase").forEach((el) => {
    const i = order.indexOf(el.dataset.phase);
    el.classList.toggle("active", i === idx);
    el.classList.toggle("done", i < idx);
  });
}

/* ───────────────────────── Scene iframe + harness ───────────────────────── */
// Injected (on one line, so error line numbers still match the model's code) into every generated scene.
const HARNESS = `<script>(function(){var P=function(t,d){try{parent.postMessage(Object.assign({__i3d:1,type:t},d||{}),"*")}catch(e){}};var g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,o){if(t==="webgl2"||t==="webgl"){o=Object.assign({},o||{},{preserveDrawingBuffer:true})}return g.call(this,t,o)};var sent=0,ready=0;function err(m){if(sent>2)return;sent++;P("error",{message:String(m).slice(0,1500)})}window.addEventListener("error",function(e){if(e.target&&e.target!==window&&e.target.tagName){err("Failed to load "+(e.target.src||e.target.tagName.toLowerCase()));return}err((e.message||"Script error")+(e.lineno?" (line "+e.lineno+":"+e.colno+")":""))},true);window.addEventListener("unhandledrejection",function(e){var r=e.reason;err("Unhandled promise rejection: "+(r&&(r.stack||r.message)||r))});var ce=console.error;console.error=function(){var m=[].map.call(arguments,function(a){return a&&a.message?a.message:String(a)}).join(" ");if(/THREE|shader|WebGL|is not|undefined|Error/i.test(m))err(m);return ce.apply(console,arguments)};var t0=Date.now();(function poll(){var c=document.querySelector("canvas");if(c&&c.width>0){setTimeout(function(){if(!ready){ready=1;P("ready")}},700);return}if(Date.now()-t0>20000){err("The scene never created a WebGL canvas (nothing rendered after 20s).");return}setTimeout(poll,150)})();window.addEventListener("message",function(e){if(!e.data||e.data.type!=="snap")return;var cs=[].slice.call(document.querySelectorAll("canvas")).sort(function(a,b){return b.width*b.height-a.width*a.height});var c=cs[0];if(!c){P("snap",{data:null});return}try{var s=320,o=document.createElement("canvas");o.width=o.height=s;var k=Math.max(s/c.width,s/c.height);o.getContext("2d").drawImage(c,(s-c.width*k)/2,(s-c.height*k)/2,c.width*k,c.height*k);P("snap",{data:o.toDataURL("image/jpeg",.82)})}catch(x){P("snap",{data:null})}})})();<\/script>`;

function withHarness(code) {
  const m = code.match(/<head[^>]*>/i);
  if (m) return code.slice(0, m.index + m[0].length) + HARNESS + code.slice(m.index + m[0].length);
  return HARNESS + code;
}

function renderScene(code) {
  hideError();
  state.lastError = null;
  els.emptyState.hidden = true;
  els.orbitHint.hidden = true;
  // Load the scene behind the preview; it is revealed once it reports its first frame.
  els.frame.hidden = false;
  els.frame.classList.add("loading");
  els.frame.srcdoc = withHarness(code);
}

function revealFrame() {
  els.frame.classList.remove("loading");
  els.previewCanvas.hidden = true;
  preview3d.stop();
  if (!state.busy) els.progress.hidden = true;
}

function showFrame(on) {
  els.frame.hidden = !on;
  els.frame.classList.remove("loading");
  els.previewCanvas.hidden = on;
  if (on) preview3d.stop(); else els.orbitHint.hidden = true;
}

let pendingSnap = null;
window.addEventListener("message", (e) => {
  if (e.source !== els.frame.contentWindow || !e.data?.__i3d) return;
  const { type } = e.data;
  if (type === "ready") {
    revealFrame();
    els.orbitHint.hidden = false;
    els.orbitHint.style.animation = "none"; void els.orbitHint.offsetWidth; els.orbitHint.style.animation = "";
    const scene = state.scene;
    if (scene && !scene.saved) setTimeout(() => {
      if (state.scene !== scene || state.lastError) return; // only keep scenes that actually run
      requestSnap().then((thumb) => saveScene(scene, thumb));
    }, 1600);
  } else if (type === "error") {
    if (state.lastError) return;
    state.lastError = e.data.message;
    revealFrame();
    showError("The scene hit an error", e.data.message, { fix: "Ask Kimi to fix it" });
  } else if (type === "snap" && pendingSnap) {
    pendingSnap(e.data.data); pendingSnap = null;
  }
});
function requestSnap() {
  return new Promise((res) => {
    pendingSnap = res;
    els.frame.contentWindow?.postMessage({ type: "snap" }, "*");
    setTimeout(() => { if (pendingSnap === res) { pendingSnap = null; res(null); } }, 1500);
  });
}

/* ───────────────────────── Error card ───────────────────────── */
let errorAction = null;
function showError(title, msg, opts = {}) {
  els.errorTitle.textContent = title;
  els.errorMsg.textContent = msg;
  if (opts.fix) {
    els.fixBtn.hidden = false; els.fixBtn.textContent = opts.fix;
    errorAction = () => {
      const s = state.scene;
      if (s?.truncated) followUp("Your previous output was cut off before the file ended. Rewrite the complete scene more compactly (well under 450 lines) so it fits.", "fix");
      else followUp(`When run in the browser, the scene produced this error:\n\n${msg}\n\nFind the root cause and fix it.`, "fix");
    };
  } else if (opts.action) {
    els.fixBtn.hidden = false; els.fixBtn.textContent = opts.action; errorAction = opts.onAction;
  } else { els.fixBtn.hidden = true; errorAction = null; }
  els.errorCard.hidden = false;
}
function hideError() { els.errorCard.hidden = true; }
els.fixBtn.addEventListener("click", () => { hideError(); errorAction?.(); });
els.dismissErr.addEventListener("click", hideError);

/* ───────────────────────── Tabs & stage actions ───────────────────────── */
document.querySelector(".tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) setTab(t.dataset.tab); });
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  els.codeView.hidden = tab !== "code";
  els.thinkView.hidden = tab !== "thinking";
  els.codeView.dataset.empty = "// The generated Three.js scene will stream in here.";
  els.thinkView.dataset.empty = state.busy ? "Waiting for Kimi's reasoning…" : "Kimi's reasoning trace appears here when the model exposes it.";
}

els.reloadBtn.addEventListener("click", () => state.scene?.code && renderScene(state.scene.code));
els.openBtn.addEventListener("click", () => {
  if (!state.scene?.code) return;
  const url = URL.createObjectURL(new Blob([state.scene.code], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
els.downloadBtn.addEventListener("click", () => {
  if (!state.scene?.code) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([state.scene.code], { type: "text/html" }));
  a.download = `kimi-3d-${state.scene.style}-${state.scene.id.slice(0, 6)}.html`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
});
els.fullBtn.addEventListener("click", () => {
  const p = document.querySelector(".stage-panel");
  document.fullscreenElement ? document.exitFullscreen() : p.requestFullscreen?.();
});

/* ───────────────────────── History (IndexedDB) ───────────────────────── */
const db = (() => {
  let p;
  const open = () => p ||= new Promise((res, rej) => {
    const r = indexedDB.open("image-to-3d", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("scenes", { keyPath: "id" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("scenes", mode); const out = fn(t.objectStore("scenes")); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };
  return {
    all: () => tx("readonly", (s) => s.getAll()),
    put: (v) => tx("readwrite", (s) => s.put(v)),
    del: (id) => tx("readwrite", (s) => s.delete(id)),
    clear: () => tx("readwrite", (s) => s.clear()),
  };
})();

async function saveScene(scene, thumb) {
  scene.saved = true;
  try {
    await db.put({
      id: scene.id, createdAt: Date.now(), style: scene.style, notes: scene.notes, brief: scene.brief, refinements: scene.refinements,
      code: scene.code, thumb: thumb || scene.image.thumb, image: { dataUrl: scene.image.dataUrl, thumb: scene.image.thumb, palette: scene.image.palette, w: scene.image.w, h: scene.image.h },
    });
    const all = (await db.all()).sort((a, b) => b.createdAt - a.createdAt);
    for (const old of all.slice(24)) await db.del(old.id);
    renderHistory();
  } catch (e) { console.warn("History save failed", e); }
}

async function renderHistory() {
  let items = [];
  try { items = (await db.all()).sort((a, b) => b.createdAt - a.createdAt); } catch { /* IDB unavailable */ }
  els.clearHistory.hidden = !items.length;
  if (!items.length) { els.history.innerHTML = '<p class="muted small">Your generated scenes will appear here.</p>'; return; }
  els.history.innerHTML = items.map((it) => `
    <button class="hist${state.scene?.id === it.id ? " current" : ""}" data-id="${it.id}" title="${escapeHtml(it.style)}${it.refinements?.length ? ` · ${it.refinements.length} refinement(s)` : ""} · ${new Date(it.createdAt).toLocaleString()}">
      <img src="${it.thumb}" alt="" />
      <img class="src" src="${it.image.thumb}" alt="" />
      <span class="del" data-del="${it.id}" role="button" aria-label="Delete">✕</span>
    </button>`).join("");
}

els.history.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); await db.del(del.dataset.del); return renderHistory(); }
  const btn = e.target.closest(".hist"); if (!btn || state.busy) return;
  const it = (await db.all()).find((x) => x.id === btn.dataset.id); if (!it) return;
  state.scene = { id: it.id, code: it.code, image: it.image, style: it.style, notes: it.notes, brief: it.brief, refinements: it.refinements || [], saved: true };
  setImage(it.image);
  els.notes.value = it.notes || "";
  els.codeView.innerHTML = highlight(it.code); els.codeCount.textContent = `${it.code.split("\n").length}`;
  els.thinkView.textContent = "";
  setTab("scene");
  renderScene(it.code);
  renderHistory(); updateCta();
});
els.clearHistory.addEventListener("click", async () => { await db.clear(); renderHistory(); });

/* ───────────────────────── Utilities ───────────────────────── */
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function stickToBottom(el) { if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight; }
let toastTimer;
function toast(msg, kind = "") {
  els.toast.textContent = msg; els.toast.className = `toast ${kind}`; els.toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (els.toast.hidden = true), 2800);
}
function highlight(code) {
  const re = /(<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[a-zA-Z][\w-]*|\/?>)|\b(const|let|var|function|return|new|import|from|export|for|if|else|while|class|extends|this|of|in|true|false|null|undefined|async|await)\b|\b(\d+(?:\.\d+)?)\b/g;
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    out += escapeHtml(code.slice(last, m.index));
    const cls = m[1] ? "tk-com" : m[2] ? "tk-str" : m[3] ? "tk-tag" : m[4] ? "tk-kw" : "tk-num";
    out += `<span class="${cls}">${escapeHtml(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + escapeHtml(code.slice(last));
}

/* ───────────────────────── Preview stage (idle + sculpting point cloud) ───────────────────────── */
const preview3d = (() => {
  const canvas = els.previewCanvas;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  const root = new THREE.Group(); scene.add(root);
  const clock = new THREE.Clock();
  let mode = "idle", cloud = null, uniforms = null, tick = null;

  const resize = () => {
    const r = els.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    if (uniforms) uniforms.uPixelRatio.value = renderer.getPixelRatio();
  };
  new ResizeObserver(resize).observe(els.stage);

  const clear = () => {
    root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    root.clear(); root.rotation.set(0, 0, 0); cloud = null; uniforms = null;
  };

  function idle() {
    clear(); mode = "idle";
    const lime = new THREE.Color("#e0ff4f"), violet = new THREE.Color("#9d8cff");
    const core = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.15, 1)), new THREE.LineBasicMaterial({ color: lime, transparent: true, opacity: 0.55 }));
    const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.7, 0)), new THREE.LineBasicMaterial({ color: violet, transparent: true, opacity: 0.35 }));
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(2.1 + Math.random() * 1.6);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc9d1e6, size: 0.018, transparent: true, opacity: 0.55 }));
    const ringG = new THREE.RingGeometry(2.25, 2.27, 128);
    const ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: lime, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = Math.PI / 2.4;
    root.add(core, shell, dust, ring);
    root.position.set(0, 0.45, 0);
    tick = (t) => {
      core.rotation.set(t * 0.21, t * 0.33, 0);
      shell.rotation.set(-t * 0.12, -t * 0.18, t * 0.05);
      dust.rotation.y = t * 0.03;
      ring.rotation.z = t * 0.25;
      core.scale.setScalar(1 + Math.sin(t * 1.6) * 0.03);
    };
    start();
  }

  function sculpt(image, active) {
    clear(); mode = "sculpt";
    root.position.set(0, active ? 0.35 : 0.25, 0);
    const src = image.canvas || null;
    const build = (cnv) => {
      const cols = 170, rows = Math.max(40, Math.round(cols * (cnv.height / cnv.width)));
      const s = document.createElement("canvas"); s.width = cols; s.height = rows;
      const ctx = s.getContext("2d"); ctx.drawImage(cnv, 0, 0, cols, rows);
      const px = ctx.getImageData(0, 0, cols, rows).data;
      const span = 3.2, aspect = rows / cols;
      const w = aspect > 1 ? span / aspect : span, h = w * aspect;
      const n = cols * rows;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), depth = new Float32Array(n), rnd = new Float32Array(n);
      for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) {
        const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
        pos[i * 3] = (x / (cols - 1) - 0.5) * w; pos[i * 3 + 1] = (0.5 - y / (rows - 1)) * h; pos[i * 3 + 2] = 0;
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const cx = x / cols - 0.5, cy = y / rows - 0.5;
        depth[i] = (lum - 0.45) * 0.7 + (0.25 - (cx * cx + cy * cy)) * 0.6; // brightness + centre bulge
        rnd[i] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
      g.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
      g.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
      uniforms = {
        uTime: { value: 0 }, uScan: { value: -0.2 }, uRise: { value: 0 }, uActive: { value: active ? 1 : 0 },
        uSize: { value: Math.max(2.2, 34 * (w / cols)) * 10 }, uPixelRatio: { value: renderer.getPixelRatio() }, uH: { value: h },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms, transparent: true, depthWrite: false,
        vertexShader: `
          attribute vec3 aColor; attribute float aDepth; attribute float aRand;
          uniform float uTime, uScan, uRise, uActive, uSize, uPixelRatio, uH;
          varying vec3 vColor; varying float vAlpha;
          void main() {
            vec3 p = position;
            float yN = p.y / uH + 0.5;
            float raised = max(uRise, 1.0 - smoothstep(uScan - 0.18, uScan, yN));
            float band = uActive * exp(-pow((yN - uScan) * 22.0, 2.0));
            p.z = aDepth * raised + band * 0.12 + sin(uTime * 1.7 + aRand * 6.2831) * 0.012 * uActive;
            vColor = mix(aColor, vec3(0.878, 1.0, 0.31), band * 0.85);
            vAlpha = mix(0.55, 1.0, raised) ;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uSize * uPixelRatio * (1.0 + band * 1.6) / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying vec3 vColor; varying float vAlpha;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = dot(c, c);
            if (d > 0.25) discard;
            gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.12, d));
          }`,
      });
      cloud = new THREE.Points(g, mat);
      root.add(cloud);
      // A faint lime frame around the image plane.
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w * 1.04, h * 1.04)), new THREE.LineBasicMaterial({ color: 0xe0ff4f, transparent: true, opacity: active ? 0.35 : 0.15 }));
      root.add(frame);
      const fit = Math.max(h, w / camera.aspect) * 1.25;
      camera.position.z = Math.max(3.4, fit / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    };
    if (src) build(src);
    else { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; c.getContext("2d").drawImage(i, 0, 0); if (mode === "sculpt" && !cloud) build(c); }; i.src = image.dataUrl; }

    const t0 = clock.getElapsedTime();
    tick = (t) => {
      if (!uniforms) return;
      const lt = t - t0;
      uniforms.uTime.value = lt;
      if (active) {
        const sweep = (lt * 0.32) % 1.45 - 0.2;
        uniforms.uScan.value = sweep;
        if (lt * 0.32 > 1.3) uniforms.uRise.value = 1;
      } else { uniforms.uRise.value = Math.min(1, lt * 0.8); uniforms.uScan.value = -1; }
      root.rotation.y = Math.sin(lt * 0.45) * (active ? 0.42 : 0.3);
      root.rotation.x = -0.12 + Math.sin(lt * 0.33) * 0.08;
    };
    start();
  }

  function start() {
    canvas.hidden = false; resize();
    renderer.setAnimationLoop(() => { tick?.(clock.getElapsedTime()); renderer.render(scene, camera); });
  }
  function stop() { renderer.setAnimationLoop(null); }
  return { idle, sculpt, stop };
})();

/* ───────────────────────── Boot ───────────────────────── */
(async function boot() {
  loadByok();
  try { Object.assign(state.server, await (await fetch("/api/config")).json()); } catch { /* offline */ }
  renderKeyStatus();
  setTab("scene");
  preview3d.idle();
  renderHistory();
  if (!hasAnyKey()) setTimeout(() => toast("Tip: add your Token Factory key with “Add API key”"), 900);
})();
