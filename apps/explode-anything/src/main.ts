import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CameraModel } from './model';
import { SHOWCASE_SCORE } from './explosion';
import { poseForPreset, poseForSelection, poseForAssembly } from './framing';
import type { CameraPose, PresetName, ViewMode } from './types';
import './styles.css';

let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let model: CameraModel;
let environmentTarget: THREE.WebGLRenderTarget;
let canvasElement: HTMLCanvasElement;
let assembly = 0;
let aperture = 1.8;
let selectedId: string | null = null;
let hoveredId: string | null = null;
let mode: ViewMode = 'materials';
let showcase = false;
let playTween: { from: number; to: number; start: number; duration: number } | null = null;
let poseTween: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number; duration: number } | null = null;
let showcaseStartTime = 0;
let showcaseFrameId = 0;
let renderFrameId = 0;
let activePreset: PresetName | null = 'hero';
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let rendering = true;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const listeners = new AbortController();
let resizeObserver: ResizeObserver;

function getEl<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element: ${id}`);
  return element as T;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? ''));
}

function on<K extends keyof HTMLElementEventMap>(element: HTMLElement | Document, type: K, handler: (event: HTMLElementEventMap[K]) => void) {
  element.addEventListener(type, handler as EventListener, { signal: listeners.signal });
}

function buildUI() {
  getEl('app').innerHTML = `
    <div class="app-shell mode-materials" data-assembled="true">
      <header class="top-bar">
        <div class="brand-lockup">
          <h1 class="wordmark">EXPLODE<span class="accent">ANYTHING</span></h1>
          <span class="eyebrow brand-subtitle">Inside a mirrorless camera</span>
        </div>
        <p class="intro">Pull it apart. Discover what makes the image.</p>
        <div class="header-actions" id="headerActions">
          <button class="btn btn-ghost btn-sm icon-btn" id="presentBtn" aria-label="Enter presentation mode" title="Presentation mode">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 1h10a1 1 0 011 1v8a1 1 0 01-1 1H9v1h1a1 1 0 110 2H6a1 1 0 110-2h1v-1H3a1 1 0 01-1-1V2a1 1 0 011-1z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" id="showcaseBtn" aria-label="Play 20-second showcase">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2l8 6-8 6V2z"/></svg>
            Play showcase
          </button>
          <span class="header-badge" id="assemblyBadge" aria-hidden="true">0%</span>
        </div>
        <div class="presentation-bar" id="presentationBar">
          <span class="presentation-label">Presentation</span>
          <button class="btn btn-ghost btn-sm" id="exitPresent">Exit</button>
        </div>
      </header>

      <main class="stage">
        <section class="view-container" id="viewContainer" aria-label="3D exhibit">
          <canvas id="scene" aria-label="Interactive 3D mirrorless camera. Drag to orbit and click a part to inspect it."></canvas>
          <p class="concept-note">Conceptual assembly. Geometry and optical behavior are simplified.</p>
          <nav class="view-controls" aria-label="Camera and display controls">
            <span class="section-label">View</span>
            <div class="preset-row">
              <button class="btn-preset active" data-preset="hero">Hero</button>
              <button class="btn-preset" data-preset="front">Front</button>
              <button class="btn-preset" data-preset="rear">Rear</button>
              <button class="btn-preset" data-preset="exploded">Exploded</button>
              <button class="btn-preset" data-preset="lens">Lens detail</button>
            </div>
            <div class="mode-row" aria-label="Display mode">
              <button class="btn-mode active" data-mode="materials">Materials</button>
              <button class="btn-mode" data-mode="technical">Technical</button>
              <button class="btn-mode" data-mode="xray">X-ray</button>
            </div>
          </nav>
          <button class="mobile-panel-toggle" id="mobilePanelToggle" aria-label="Show details panel" aria-expanded="false" aria-controls="inspector">Details ↑</button>
          <div class="labels-layer" id="labelsLayer" aria-live="polite"></div>
          <div class="loading-indicator" id="loading" hidden>Preparing the exhibit…</div>
          <div class="webgl-fallback" id="webglFallback" role="alert" hidden>
            <h2>The 3D exhibit couldn’t start.</h2>
            <p id="fallbackMessage">WebGL is unavailable. Enable hardware acceleration or open this page in a current browser with WebGL support, then reload.</p>
          </div>
        </section>

        <aside class="inspector" id="inspector" aria-label="Component inspection and mechanisms">
          <section class="inspector-section">
            <div class="panel-heading"><span class="dot"></span><span>Inspect</span><span class="panel-actions"><button id="clearSelBtn" aria-label="Clear selection" title="Clear selection (Escape)">✕</button></span></div>
            <div class="inspection-content" id="inspectionContent">
              <div class="inspection-default">Hover a part to see its name.<br>Click to select and inspect.</div>
            </div>
          </section>
          <section class="inspector-section">
            <div class="section-label">Mechanisms</div>
            <div class="mechanism-heading"><span class="mech-label">Aperture</span><span class="aperture-display" id="apertureDisplay">f/1.8</span></div>
            <div class="range-row">
              <span class="range-value">f/1.8</span>
              <input type="range" min="1.8" max="16" step="0.1" value="1.8" id="apertureInput" aria-label="Aperture f-stop">
              <span class="range-value">f/16</span>
            </div>
            <p class="helper">Simplified overlapping-iris visualization.</p>
            <div class="mechanism-buttons">
              <button class="btn btn-ghost btn-sm" id="shutterBtn">Release shutter</button>
              <button class="btn btn-ghost btn-sm" id="sensorFocusBtn">Sensor detail</button>
            </div>
            <label class="ray-toggle" for="lightRayToggle">
              <input type="checkbox" id="lightRayToggle">
              <span>Light-path rays<small>Schematic, not a ray-traced simulation.</small></span>
            </label>
          </section>
          <section class="inspector-section">
            <div class="section-label">Parts</div>
            <div class="parts-list" id="partsList"></div>
          </section>
        </aside>
      </main>

      <footer class="assembly-bar" id="assemblyBar">
        <div class="assembly-readout">
          <span class="section-label">Assembly</span>
          <span class="assembly-percent" id="assemblyPercent">0<small>%</small></span>
        </div>
        <div class="assembly-slider">
          <div class="assembly-track"><div class="assembly-fill" id="assemblyFill"></div></div>
          <input type="range" min="0" max="100" step="0.5" value="0" id="assemblyInput" aria-label="Assembly: zero assembled, one hundred exploded" aria-valuetext="0 percent exploded">
          <div class="assembly-marks" aria-hidden="true"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
        </div>
        <div class="transport-btns">
          <button class="transport-btn" id="explodeBtn" aria-label="Fully explode"><span class="button-symbol">◈</span> Explode</button>
          <button class="transport-btn" id="assembleBtn" aria-label="Fully assemble"><span class="button-symbol">◆</span> Assemble</button>
          <button class="transport-btn play-btn" id="playBtn" aria-label="Play animation" title="Play / pause">
            <svg id="playIcon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2l8 6-8 6V2z"/></svg>
            <svg id="pauseIcon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="display:none" aria-hidden="true"><path d="M3 2h3v12H3zm7 0h3v12h-3z"/></svg>
          </button>
          <button class="transport-btn reset-btn" id="resetBtn" aria-label="Reset exhibit" title="Reset">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 11-1.6-3.9L13 5.1V1h-2v2.1A7 7 0 1015 8h-1.5z"/></svg>
          </button>
        </div>
      </footer>
      <div class="showcase-indicator" id="showcaseIndicator"><span class="live-dot"></span> Showcase <span id="showcaseTimer">20</span>s <button id="cancelShowcase" aria-label="Cancel showcase">✕</button></div>
    </div>
  `;
  canvasElement = getEl<HTMLCanvasElement>('scene');
}

function buildPartsList() {
  const list = getEl('partsList');
  const categories = { Body: 'Body', Optics: 'Lens / Optics', Electronics: 'Electronics', Hardware: 'Hardware' } as const;
  for (const category of Object.keys(categories) as (keyof typeof categories)[]) {
    const components = model.components.filter(component => component.category === category);
    const group = document.createElement('details');
    group.className = 'part-category';
    group.innerHTML = `<summary><span class="cat-caret">▼</span><span>${categories[category]}</span><span class="cat-count">${components.length}</span></summary>`;
    const items = document.createElement('div');
    items.className = 'part-category-items';
    for (const component of components) {
      const button = document.createElement('button');
      button.className = 'part-item';
      button.dataset.id = component.id;
      button.innerHTML = `${escapeHtml(component.name)}<span class="part-item-dot">●</span>`;
      on(button, 'click', () => selectPart(component.id));
      items.appendChild(button);
    }
    group.appendChild(items);
    list.appendChild(group);
  }
}

function initScene() {
  const container = getEl('viewContainer');
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio <= 2, canvas: canvasElement, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  // An opaque clear color gives isolated transmissive optics a dark transmission backdrop.
  renderer.setClearColor('#17191b', 1);

  scene = new THREE.Scene();
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  environmentTarget = pmrem.fromScene(room, 0.035, 0.1, 100);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.85;
  room.dispose();
  pmrem.dispose();

  const key = new THREE.DirectionalLight('#fff4e5', 2.35);
  key.position.set(4, 7, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 28;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#d9e7ff', 1.0);
  fill.position.set(-5, 3, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#f0f3ff', 1.8);
  rim.position.set(-2, 5, -6);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ color: '#000000', opacity: 0.25 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.65;
  ground.receiveShadow = true;
  scene.add(ground);

  model = new CameraModel();
  scene.add(model.root);
  applyViewMode('materials');
  updateAssembly(0);
  updateApertureDisplay();

  camera = new THREE.PerspectiveCamera(32, width / height, 0.08, 160);
  controls = new OrbitControls(camera, canvasElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.58;
  controls.minDistance = 1.0;
  controls.maxDistance = 90;
  controls.maxPolarAngle = Math.PI * 0.78;
  controls.enablePan = true;
  controls.addEventListener('start', () => {
    cancelShowcase();
    cancelPlayTween();
    poseTween = null;
    activePreset = null;
    updatePresetButtons();
  });
  goToPose('hero', 0);

  buildClickables();
  buildPartsList();
  wireEventListeners();
  startRender();
}

function startRender() {
  let previousTime = performance.now();
  const animate = (now: number) => {
    if (!rendering) return;
    renderFrameId = requestAnimationFrame(animate);
    const dt = Math.min(0.05, Math.max(0.001, (now - previousTime) / 1000));
    previousTime = now;
    if (poseTween) {
      const alpha = Math.min(1, (now - poseTween.start) / poseTween.duration);
      const eased = 1 - Math.pow(1 - alpha, 3);
      camera.position.lerpVectors(poseTween.fromPos, poseTween.toPos, eased);
      controls.target.lerpVectors(poseTween.fromTarget, poseTween.toTarget, eased);
      if (alpha >= 1) poseTween = null;
    }
    if (playTween) {
      const tween = playTween;
      const alpha = Math.min(1, (now - tween.start) / tween.duration);
      const eased = alpha < 0.5 ? 2 * alpha * alpha : 1 - Math.pow(-2 * alpha + 2, 2) / 2;
      updateAssembly(alpha >= 1 ? tween.to : THREE.MathUtils.lerp(tween.from, tween.to, eased));
      if (alpha >= 1) {
        playTween = null;
        updatePlayButton();
      }
    }
    model.iris.update(dt);
    model.animateShutter();
    model.updateRays(dt, now / 1000);
    controls.update();
    renderer.render(scene, camera);
    updateLabelPosition();
  };
  renderFrameId = requestAnimationFrame(animate);
}

function updateAssembly(value: number) {
  assembly = THREE.MathUtils.clamp(value, 0, 100);
  model.interpolateExplosion(assembly);
  const display = Math.round(assembly);
  getEl('assemblyFill').style.width = `${assembly}%`;
  const slider = getEl<HTMLInputElement>('assemblyInput');
  slider.value = String(assembly);
  slider.setAttribute('aria-valuetext', `${display} percent exploded`);
  getEl('assemblyBadge').textContent = `${display}%`;
  getEl('assemblyPercent').innerHTML = `${display}<small>%</small>`;
  getEl('assemblyBadge').classList.toggle('animated', assembly > 0);
  document.querySelector('.app-shell')?.setAttribute('data-assembled', String(assembly <= 0.01));
}

function updatePlayButton() {
  const playing = playTween !== null;
  getEl('playIcon').style.display = playing ? 'none' : 'inline';
  getEl('pauseIcon').style.display = playing ? 'inline' : 'none';
  getEl('playBtn').setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
}

function setExplodeTarget(target: number, durationMs = 1200) {
  cancelPlayTween();
  playTween = { from: assembly, to: target, start: performance.now(), duration: reducedMotion ? 1 : durationMs };
  updatePlayButton();
}

function cancelPlayTween() {
  playTween = null;
  if (document.getElementById('playBtn')) updatePlayButton();
}

function cancelShowcase() {
  showcase = false;
  cancelAnimationFrame(showcaseFrameId);
  getEl('showcaseIndicator')?.classList.remove('visible');
  document.querySelector('.app-shell')?.classList.remove('showcase-active');
  cancelPlayTween();
}

function startShowcase() {
  cancelShowcase();
  updateAssembly(0);
  selectPart(null);
  getEl<HTMLInputElement>('lightRayToggle').checked = false;
  model.rayGroup.visible = false;
  showcase = true;
  showcaseStartTime = performance.now();
  getEl('showcaseIndicator').classList.add('visible');
  document.querySelector('.app-shell')?.classList.add('showcase-active');
  goToPose('hero', 0);
  const fired = new Set<number>();
  const update = (now: number) => {
    if (!showcase) return;
    const elapsed = (now - showcaseStartTime) / 1000;
    getEl('showcaseTimer').textContent = String(Math.ceil(Math.max(0, 20 - elapsed)));
    if (elapsed >= 20) {
      cancelShowcase();
      updateAssembly(0);
      selectPart(null);
      setAperture(1.8);
      goToPose('hero', reducedMotion ? 0 : 300);
      return;
    }
    SHOWCASE_SCORE.forEach((action, index) => {
      if (elapsed < action.at || fired.has(index)) return;
      fired.add(index);
      switch (action.type) {
        case 'pose': goToPose(action.preset as PresetName, 800); break;
        case 'assembly': setExplodeTarget(action.to, action.duration * 1000); break;
        case 'aperture': setAperture(action.value); break;
        case 'shutter': model.releaseShutter(); break;
        case 'rays': model.rayGroup.visible = action.value; break;
        case 'select': selectPart(action.id); break;
      }
    });
    showcaseFrameId = requestAnimationFrame(update);
  };
  showcaseFrameId = requestAnimationFrame(update);
}

function setAperture(value: number) {
  aperture = THREE.MathUtils.clamp(value, 1.8, 16);
  getEl<HTMLInputElement>('apertureInput').value = String(aperture);
  model.iris.set(aperture);
  updateApertureDisplay();
}

function updateApertureDisplay() {
  const display = aperture < 10 ? aperture.toFixed(1) : aperture.toFixed(1).replace(/\.0$/, '');
  getEl('apertureDisplay').textContent = `f/${display}`;
  getEl('apertureInput').setAttribute('aria-valuetext', `f/${display}`);
}

function applyViewMode(nextMode: ViewMode) {
  mode = nextMode;
  model.applyViewMode(mode);
  model.setHighlight(selectedId ?? hoveredId);
  document.querySelectorAll('.btn-mode').forEach(button => button.classList.toggle('active', button.getAttribute('data-mode') === mode));
  const shell = document.querySelector('.app-shell');
  shell?.classList.remove('mode-materials', 'mode-technical', 'mode-xray');
  shell?.classList.add(`mode-${mode}`);
}

function selectPart(id: string | null) {
  selectedId = id && model.components.some(component => component.id === id) ? id : null;
  const selectedComponent = model.components.find(component => component.id === selectedId);
  if (selectedComponent && !selectedComponent.group.visible) model.setIsolation(null);
  model.setHighlight(selectedId ?? hoveredId);
  const content = getEl('inspectionContent');
  content.classList.toggle('has-selection', Boolean(selectedId));
  content.classList.toggle('is-isolated', model.hasIsolation());
  content.classList.toggle('sole-isolation', Boolean(selectedId && model.isSoleSelection(selectedId)));
  if (!selectedId) {
    content.innerHTML = '<div class="inspection-default">Hover a part to see its name.<br>Click to select and inspect.</div>';
  } else {
    const component = model.components.find(item => item.id === selectedId)!;
    content.innerHTML = `
      <div class="inspection-name">${escapeHtml(component.name)}</div>
      <div class="inspection-category">${escapeHtml(component.category)} · ${escapeHtml(component.parent)}</div>
      <div class="inspection-description">${escapeHtml(component.description)}</div>
      <button class="btn btn-ghost btn-sm focus-part" id="focusSelected">${model.isSoleSelection(selectedId) ? 'Show full assembly' : 'Focus part'}</button>
      <button class="btn btn-ghost btn-sm show-all-parts" id="showAllParts">Show all parts</button>
    `;
    on(getEl('focusSelected'), 'click', () => {
      cancelShowcase();
      if (model.isSoleSelection(selectedId!)) {
        showAllParts();
        return;
      }
      model.setIsolation([selectedId!]);
      const aspect = canvasElement.clientWidth / Math.max(1, canvasElement.clientHeight);
      goToCustomPose(poseForSelection(camera, model, selectedId!, aspect, controls.target));
      selectPart(selectedId);
    });
    on(getEl('showAllParts'), 'click', showAllParts);
  }
  document.querySelectorAll('.part-item').forEach(button => button.classList.toggle('selected', button.getAttribute('data-id') === selectedId));
  updateLabelPosition();
}

function syncIsolationControls() {
  const content = getEl('inspectionContent');
  content.classList.toggle('is-isolated', model.hasIsolation());
  content.classList.toggle('sole-isolation', Boolean(selectedId && model.isSoleSelection(selectedId)));
  const focus = document.getElementById('focusSelected');
  if (focus && selectedId) focus.textContent = model.isSoleSelection(selectedId) ? 'Show full assembly' : 'Focus part';
}

function showAllParts() {
  model.setIsolation(null);
  goToPose(assembly > 0 ? 'exploded' : 'hero');
  selectPart(selectedId);
}

function updateLabelPosition() {
  if (!camera || !model) return;
  const labels = getEl('labelsLayer');
  let label = labels.firstElementChild as HTMLElement | null;
  if (!selectedId) {
    label?.remove();
    return;
  }
  if (!label || label.dataset.partId !== selectedId) {
    labels.replaceChildren();
    const component = model.components.find(item => item.id === selectedId)!;
    label = document.createElement('div');
    label.className = 'parts-label';
    label.dataset.partId = selectedId;
    label.innerHTML = `<span>${escapeHtml(component.name)}</span><span class="category">${escapeHtml(component.category)}</span>`;
    labels.appendChild(label);
  }
  const center = model.getBounds([selectedId]).getCenter(new THREE.Vector3()).project(camera);
  const width = canvasElement.clientWidth;
  const height = canvasElement.clientHeight;
  if (center.z < -1 || center.z > 1 || Math.abs(center.x) > 1.05 || Math.abs(center.y) > 1.05) {
    label.style.display = 'none';
    return;
  }
  label.style.display = 'flex';
  const x = (center.x * 0.5 + 0.5) * width;
  const y = (-center.y * 0.5 + 0.5) * height;
  label.style.left = `${THREE.MathUtils.clamp(x, 8, Math.max(8, width - label.offsetWidth - 86))}px`;
  label.style.top = `${THREE.MathUtils.clamp(y, 55, height - 12)}px`;
}

function updatePresetButtons() {
  document.querySelectorAll('.btn-preset').forEach(button => button.classList.toggle('active', button.getAttribute('data-preset') === activePreset));
}

function goToCustomPose(pose: CameraPose, durationMs = 900) {
  activePreset = null;
  updatePresetButtons();
  setPoseTween(pose, durationMs);
  syncIsolationControls();
}

function setPoseTween(pose: CameraPose, durationMs = 900) {
  const position = new THREE.Vector3(...pose.position);
  const target = new THREE.Vector3(...pose.target);
  if (durationMs <= 0 || reducedMotion) {
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
    poseTween = null;
    return;
  }
  poseTween = {
    fromPos: camera.position.clone(), toPos: position,
    fromTarget: controls.target.clone(), toTarget: target,
    start: performance.now(), duration: durationMs,
  };
}

function goToPose(preset: PresetName, durationMs = 900) {
  const isolatedOptics = ['aperture', 'element1', 'element2', 'element3', 'element4', 'element5', 'element6'];
  model.setIsolation(preset === 'sensor' ? ['sensorPCB', 'sensor', 'shutter'] : preset === 'lens' && assembly > 0 ? isolatedOptics : null);
  const selectedComponent = model.components.find(component => component.id === selectedId);
  if (selectedComponent && !selectedComponent.group.visible) selectPart(null);
  const aspect = canvasElement.clientWidth / Math.max(1, canvasElement.clientHeight);
  const pose = poseForPreset(camera, model, preset, aspect, assembly);
  activePreset = preset;
  updatePresetButtons();
  setPoseTween(pose, durationMs);
  syncIsolationControls();
}

function buildClickables() {
  for (const component of model.components) component.group.userData.componentId = component.id;
}

function componentIdFor(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current && current !== model.root) {
    if (typeof current.userData.componentId === 'string') return current.userData.componentId;
    current = current.parent;
  }
  return null;
}

function pickPart(clientX: number, clientY: number) {
  const rect = canvasElement.getBoundingClientRect();
  pointer.set((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(model.getAllInteractables(), true);
  return hits.length ? componentIdFor(hits[0].object) : null;
}

function enterPresentation(enter: boolean) {
  document.querySelector('.app-shell')?.classList.toggle('presentation', enter);
  if (!enter) return;
  getEl('inspector').classList.remove('expanded');
  const toggle = getEl('mobilePanelToggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Details ↑';
}

function resetExhibit() {
  cancelShowcase();
  cancelPlayTween();
  updateAssembly(0);
  selectPart(null);
  hoveredId = null;
  applyViewMode('materials');
  setAperture(1.8);
  model.rayGroup.visible = false;
  getEl<HTMLInputElement>('lightRayToggle').checked = false;
  goToPose('hero', reducedMotion ? 0 : 650);
}

function wireEventListeners() {
  const assemblyInput = getEl<HTMLInputElement>('assemblyInput');
  on(assemblyInput, 'input', () => {
    cancelShowcase();
    cancelPlayTween();
    model.setIsolation(null);
    updateAssembly(Number(assemblyInput.value));
    const aspect = canvasElement.clientWidth / Math.max(1, canvasElement.clientHeight);
    goToCustomPose(poseForAssembly(camera, model, assembly, aspect, controls.target), reducedMotion ? 0 : 140);
  });
  on(assemblyInput, 'change', () => {
    if (assembly === 100) goToPose('exploded');
    else if (assembly === 0) goToPose('hero');
  });
  on(getEl('explodeBtn'), 'click', () => {
    cancelShowcase();
    setExplodeTarget(100, 1800);
    goToPose('exploded', 1600);
  });
  on(getEl('assembleBtn'), 'click', () => {
    cancelShowcase();
    setExplodeTarget(0, 1400);
    goToPose('hero', 1300);
  });
  on(getEl('playBtn'), 'click', () => {
    cancelShowcase();
    if (playTween) {
      cancelPlayTween();
      return;
    }
    const target = assembly >= 100 ? 0 : 100;
    setExplodeTarget(target, 1700);
    goToPose(target === 100 ? 'exploded' : 'hero', 1400);
  });
  on(getEl('resetBtn'), 'click', resetExhibit);
  on(getEl('showcaseBtn'), 'click', startShowcase);
  on(getEl('cancelShowcase'), 'click', cancelShowcase);
  on(getEl('presentBtn'), 'click', () => enterPresentation(true));
  on(getEl('exitPresent'), 'click', () => enterPresentation(false));

  document.querySelectorAll<HTMLButtonElement>('.btn-preset').forEach(button => on(button, 'click', () => {
    cancelShowcase();
    goToPose(button.dataset.preset as PresetName);
  }));
  document.querySelectorAll<HTMLButtonElement>('.btn-mode').forEach(button => on(button, 'click', () => {
    cancelShowcase();
    applyViewMode(button.dataset.mode as ViewMode);
  }));

  const apertureInput = getEl<HTMLInputElement>('apertureInput');
  on(apertureInput, 'input', () => {
    cancelShowcase();
    setAperture(Number(apertureInput.value));
  });
  on(getEl('shutterBtn'), 'click', () => {
    cancelShowcase();
    model.releaseShutter();
  });
  on(getEl('sensorFocusBtn'), 'click', () => {
    cancelShowcase();
    cancelPlayTween();
    if (assembly < 65) updateAssembly(65);
    goToPose('sensor');
    selectPart('sensor');
  });
  on(getEl('clearSelBtn'), 'click', () => selectPart(null));
  const rayToggle = getEl<HTMLInputElement>('lightRayToggle');
  on(rayToggle, 'change', () => {
    cancelShowcase();
    model.rayGroup.visible = rayToggle.checked;
  });

  const mobileToggle = getEl('mobilePanelToggle');
  on(mobileToggle, 'click', () => {
    const expanded = getEl('inspector').classList.toggle('expanded');
    mobileToggle.setAttribute('aria-expanded', String(expanded));
    mobileToggle.setAttribute('aria-label', expanded ? 'Hide details panel' : 'Show details panel');
    mobileToggle.textContent = expanded ? 'Hide ↓' : 'Details ↑';
  });

  on(document, 'keydown', event => {
    if (event.key !== 'Escape') return;
    selectPart(null);
    cancelShowcase();
    enterPresentation(false);
  });

  let isPointerDown = false;
  let dragDistance = 0;
  let pointerStart = { x: 0, y: 0 };
  let hoverSample = 0;
  on(canvasElement, 'pointerdown', event => {
    isPointerDown = true;
    pointerStart = { x: event.clientX, y: event.clientY };
    dragDistance = 0;
  });
  on(canvasElement, 'pointermove', event => {
    if (isPointerDown) {
      dragDistance = Math.max(dragDistance, Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y));
      return;
    }
    if (event.pointerType === 'touch' || performance.now() - hoverSample < 55) return;
    hoverSample = performance.now();
    hoveredId = pickPart(event.clientX, event.clientY);
    model.setHighlight(selectedId ?? hoveredId);
    canvasElement.style.cursor = hoveredId ? 'pointer' : 'grab';
    if (!selectedId) {
      const content = getEl('inspectionContent');
      if (hoveredId) {
        const component = model.components.find(item => item.id === hoveredId)!;
        content.innerHTML = `<div class="inspection-name">${escapeHtml(component.name)}</div><div class="inspection-category">${escapeHtml(component.category)}</div><div class="inspection-description">${escapeHtml(component.description)}</div>`;
      } else {
        content.innerHTML = '<div class="inspection-default">Hover a part to see its name.<br>Click to select and inspect.</div>';
      }
    }
  });
  on(canvasElement, 'pointerup', event => {
    isPointerDown = false;
    if (dragDistance > 6) return;
    cancelShowcase();
    cancelPlayTween();
    selectPart(pickPart(event.clientX, event.clientY));
  });
  on(canvasElement, 'pointercancel', () => { isPointerDown = false; });
  on(canvasElement, 'pointerleave', () => {
    isPointerDown = false;
    hoveredId = null;
    model.setHighlight(selectedId);
    if (!selectedId) getEl('inspectionContent').innerHTML = '<div class="inspection-default">Hover a part to see its name.<br>Click to select and inspect.</div>';
  });
  canvasElement.style.cursor = 'grab';

  resizeObserver = new ResizeObserver(() => {
    const rect = getEl('viewContainer').getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (activePreset) goToPose(activePreset, 0);
  });
  resizeObserver.observe(getEl('viewContainer'));
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', event => { reducedMotion = event.matches; }, { signal: listeners.signal });
  canvasElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    rendering = false;
    cancelAnimationFrame(renderFrameId);
    showFallback('The browser interrupted the graphics context. Reload the page to restart the 3D exhibit.');
  }, { signal: listeners.signal });
}

function showFallback(message?: string) {
  document.getElementById('boot-loading')?.remove();
  getEl('loading').hidden = true;
  const fallback = getEl('webglFallback');
  fallback.hidden = false;
  if (message) getEl('fallbackMessage').textContent = message;
}

function exposeDebug() {
  (window as unknown as Record<string, unknown>).__EA = {
    get state() {
      return {
        assembly, aperture: `f/${aperture.toFixed(1)}`, irisAnimating: model.iris.isAnimating, visualFNumber: model.iris.visualFNumber, parts: model.components.length,
        visibleParts: model.components.filter(component => component.group.visible).length, selected: selectedId, mode,
        playing: playTween !== null, showcase, sensorExposed: model.sensorExposed,
        assembledError: model.components.reduce((sum, component) => sum + (component.group.userData.stage as number), 0),
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, motionReduced: reducedMotion,
        canvas: { width: canvasElement.clientWidth, height: canvasElement.clientHeight }, preset: activePreset,
      };
    },
    setAssembly(value: number) { cancelShowcase(); cancelPlayTween(); updateAssembly(value); },
    select(id: string | null) { selectPart(id); },
    setMode(value: string) { if (['materials', 'technical', 'xray'].includes(value)) applyViewMode(value as ViewMode); },
    preset(value: PresetName) { goToPose(value, 0); },
    releaseShutter() { model.releaseShutter(); },
    reset: resetExhibit,
    transforms() {
      return model.components.map(component => ({ id: component.id, position: component.group.position.toArray(), quaternion: component.group.quaternion.toArray() }));
    },
  };
}

function dispose() {
  rendering = false;
  cancelAnimationFrame(renderFrameId);
  cancelAnimationFrame(showcaseFrameId);
  listeners.abort();
  resizeObserver?.disconnect();
  controls?.dispose();
  model?.dispose();
  scene?.traverse(object => {
    if (model.root.getObjectById(object.id)) return;
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    }
  });
  environmentTarget?.dispose();
  renderer?.dispose();
}

buildUI();
try {
  initScene();
  exposeDebug();
  document.getElementById('boot-loading')?.remove();
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); });
} catch (error) {
  showFallback();
  console.error('Unable to initialize the 3D exhibit:', error);
}
