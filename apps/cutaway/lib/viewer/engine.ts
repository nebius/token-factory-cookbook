import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { FlowKind, FlowSystem, Meta, Part, ViewName } from "@/lib/schema/teardown";
import type { BuiltPart } from "@/lib/sandbox/types";
import { explodeProgress } from "./explode";
import { frameBox } from "./frame";

// Warm data colours that read as moving particles on the dark stage.
export const FLOW_COLORS: Record<FlowKind, string> = {
  current: "#e8a55a",
  air: "#7fb0d0",
  heat: "#d9694a",
  signal: "#5db8a6",
  fluid: "#5b9bd5",
  force: "#c49a7a",
};

// Bright pink glow for the picked and pointed-at part: stands out on the light stage.
const ACCENT = new THREE.Color("#DAFF33");
export const VIEW_DIRS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.08, 1),
  back: new THREE.Vector3(0, 0.08, -1),
  left: new THREE.Vector3(-1, 0.08, 0),
  right: new THREE.Vector3(1, 0.08, 0),
  top: new THREE.Vector3(0, 1, 0.02),
  iso: new THREE.Vector3(1, 0.75, 1.15),
};

type Node = {
  id: string;
  part: Part;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  edges: THREE.LineSegments[];
  center: THREE.Vector3;
  half: THREE.Vector3;
  radius: number;
  own: THREE.Vector3;
  ok: boolean;
  built: boolean;
  hideTarget: number;
  hideAnim: number;
};

export type LabelPoint = { id: string; name: string; x: number; y: number; depth: number; ok: boolean };
export type ClipAxis = "x" | "y" | "z";

export type EngineOptions = { interactive?: boolean; preserveDrawingBuffer?: boolean };

/** Plain three.js scene for a teardown: builds parts, explodes, cuts, x-rays, labels, flows and snapshots. */
export class TeardownEngine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 50000);
  private controls: OrbitControls | null = null;
  private root = new THREE.Group();
  private nodes = new Map<string, Node>();
  private meta: Meta | null = null;
  private deviceRadius = 200;
  private maxOrder = 1;
  private clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6);
  private clip = { on: false, axis: "x" as ClipAxis, t: 0 };
  private explode = 0;
  private explodeTarget = 0;
  private xray = false;
  private edgesOn = true;
  private isolate: string | null = null;
  private selected: string | null = null;
  private hovered: string | null = null;
  private focus = new Set<string>();
  private system: FlowSystem | null = null;
  private flowMesh: THREE.InstancedMesh | null = null;
  private flowLine: THREE.Mesh | null = null;
  private flowT = 0;
  private edgeMat = new THREE.LineBasicMaterial({ color: "#1b1d22", transparent: true, opacity: 0.22, clippingPlanes: [this.clipPlane] });
  private tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
  private raf = 0;
  private resizeObs: ResizeObserver | null = null;
  private insets = { top: 0, bottom: 0 };
  private moveMode = false;
  private drag: { id: number; x: number; y: number; mode: "slide" | "tumble" } | null = null;
  private pointers = new Set<number>();
  private snapping = false;
  private raycaster = new THREE.Raycaster();
  private pointer: { x: number; y: number; down: { x: number; y: number } | null; dirty: boolean } = { x: 0, y: 0, down: null, dirty: false };
  private disposed = false;
  private paused = false;

  onHover: (id: string | null) => void = () => {};
  onPick: (id: string | null) => void = () => {};
  onFrame: () => void = () => {};

  constructor(
    private container: HTMLElement,
    opts: EngineOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#8a8f99", 0.6));
    const key = new THREE.DirectionalLight("#ffffff", 1.4);
    key.position.set(1, 1.6, 1.2);
    this.scene.add(key);
    this.scene.add(this.root);

    if (opts.interactive !== false) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      // Free movement, not just spinning about the middle: zoom heads for the pointer, and
      // right-drag, Shift-drag or two fingers slide the model around.
      this.controls.zoomToCursor = true;
      this.controls.screenSpacePanning = true;
      // Plain drags are handled here instead (grab the machine to slide it, drag the background to tumble it
      // freely); OrbitControls keeps Shift/right-drag slide, wheel and two-finger gestures.
      this.controls.enableRotate = false;
      this.controls.addEventListener("start", () => (this.tween = null));
      const el = this.renderer.domElement;
      el.addEventListener("dblclick", this.handleDouble);
      el.addEventListener("pointermove", this.handleMove);
      el.addEventListener("pointerdown", this.handleDown);
      el.addEventListener("pointerup", this.handleUp);
      el.addEventListener("pointercancel", this.handleUp);
      el.addEventListener("pointerleave", this.handleLeave);
    }
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  // ---------- model ----------

  setModel(meta: Meta): void {
    this.meta = meta;
    const [sx, sy, sz] = meta.device.sizeMm;
    this.deviceRadius = Math.max(20, Math.hypot(sx, sy, sz) / 2);
    this.maxOrder = Math.max(1, ...meta.parts.map((p) => p.explode.order));
    for (const n of this.nodes.values()) this.disposeNode(n);
    this.nodes.clear();
    for (const part of meta.parts) {
      const group = new THREE.Group();
      group.userData.partId = part.id;
      this.root.add(group);
      const [dx, dy, dz] = part.explode.direction;
      const own = new THREE.Vector3(dx, dy, dz);
      if (own.lengthSq() > 0) own.normalize().multiplyScalar(part.explode.distance);
      this.nodes.set(part.id, { id: part.id, part, group, meshes: [], edges: [], center: new THREE.Vector3(), half: new THREE.Vector3(1, 1, 1), radius: 1, own, ok: false, built: false, hideTarget: 0, hideAnim: 0 });
    }
    this.camera.near = this.deviceRadius / 100;
    this.camera.far = this.deviceRadius * 60;
    this.camera.updateProjectionMatrix();
    this.fit("iso", false);
  }

  /** Update one part's explode plan (after a review patch) without rebuilding meshes. */
  updatePartMeta(part: Part): void {
    const n = this.nodes.get(part.id);
    if (!n) return;
    n.part = part;
    const [dx, dy, dz] = part.explode.direction;
    n.own.set(dx, dy, dz);
    if (n.own.lengthSq() > 0) n.own.normalize().multiplyScalar(part.explode.distance);
    this.maxOrder = Math.max(1, ...[...this.nodes.values()].map((x) => x.part.explode.order));
  }

  setPart(built: BuiltPart): void {
    const n = this.nodes.get(built.id);
    if (!n) return;
    for (const c of [...n.group.children]) {
      n.group.remove(c);
      disposeObject(c);
    }
    n.meshes = [];
    n.edges = [];
    n.ok = built.ok;
    n.built = true;
    if (built.ok) {
      for (const m of built.meshes) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
        if (m.index) g.setIndex(new THREE.BufferAttribute(m.index, 1));
        g.computeBoundingSphere();
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(m.material.color),
          metalness: m.material.metalness,
          roughness: m.material.roughness,
          side: THREE.DoubleSide,
          clippingPlanes: [this.clipPlane],
          clipShadows: true,
        });
        mat.userData.baseOpacity = m.material.opacity;
        const mesh = new THREE.Mesh(g, mat);
        mesh.userData.partId = n.id;
        n.group.add(mesh);
        n.meshes.push(mesh);
        const tris = (m.index ? m.index.length : m.position.length / 3) / 3;
        if (tris < 25_000) {
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), this.edgeMat);
          e.userData.partId = n.id;
          e.raycast = () => {};
          n.group.add(e);
          n.edges.push(e);
        }
      }
      const b = built.bounds;
      if (b) {
        n.center.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
        n.half.set(Math.max(0.5, (b.max[0] - b.min[0]) / 2), Math.max(0.5, (b.max[1] - b.min[1]) / 2), Math.max(0.5, (b.max[2] - b.min[2]) / 2));
        n.radius = Math.max(1, n.half.length());
      }
    } else {
      // A failed part stays visible as a labelled dashed box so nothing silently disappears.
      const s = this.deviceRadius * 0.12;
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s)),
        new THREE.LineDashedMaterial({ color: "#e33a22", dashSize: s / 8, gapSize: s / 12, clippingPlanes: [this.clipPlane] }),
      );
      box.computeLineDistances();
      const dir = n.own.lengthSq() > 0 ? n.own.clone().normalize() : new THREE.Vector3(0, 1, 0);
      n.center.copy(dir.multiplyScalar(this.deviceRadius * 0.35));
      box.position.copy(n.center);
      box.raycast = () => {};
      n.group.add(box);
      n.half.setScalar(s / 2);
      n.radius = s;
    }
    this.applyEdges();
    this.applyMaterials();
  }

  partIds(): string[] {
    return [...this.nodes.keys()];
  }

  // ---------- view state ----------

  setExplode(t: number, animate = true): void {
    this.explodeTarget = Math.min(1, Math.max(0, t));
    if (!animate) this.explode = this.explodeTarget;
  }

  setClip(on: boolean, axis: ClipAxis = this.clip.axis, t = this.clip.t): void {
    this.clip = { on, axis, t: Math.max(-1, Math.min(1, t)) };
    this.updateClipPlane();
    this.applyMaterials();
  }

  setXray(on: boolean): void {
    this.xray = on;
    this.applyMaterials();
  }

  setEdges(on: boolean): void {
    this.edgesOn = on;
    this.applyEdges();
  }

  setIsolate(id: string | null): void {
    this.isolate = id;
    this.applyMaterials();
  }

  setSelected(id: string | null): void {
    this.selected = id;
    this.applyMaterials();
  }

  setHovered(id: string | null): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.applyMaterials();
  }

  setFocus(ids: string[]): void {
    this.focus = new Set(ids);
    this.applyMaterials();
  }

  /** Parts removed during a guided teardown fly out along their explode direction and fade away. */
  setHidden(ids: Iterable<string>, animate = true): void {
    const set = new Set(ids);
    for (const n of this.nodes.values()) {
      n.hideTarget = set.has(n.id) ? 1 : 0;
      if (!animate) n.hideAnim = n.hideTarget;
    }
  }

  /** Stop drawing frames while the view is off screen; resumes where it left off. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.loop();
    }
  }

  setTheme(dark: boolean): void {
    this.edgeMat.color.set(dark ? "#e9e7e1" : "#1b1d22");
    this.edgeMat.opacity = dark ? 0.16 : 0.22;
  }

  playSystem(system: FlowSystem | null): void {
    this.system = system;
    this.flowT = 0;
    if (this.flowMesh) {
      this.root.remove(this.flowMesh);
      disposeObject(this.flowMesh);
      this.flowMesh = null;
    }
    if (this.flowLine) {
      this.root.remove(this.flowLine);
      disposeObject(this.flowLine);
      this.flowLine = null;
    }
    if (system) {
      const r = this.deviceRadius * 0.012;
      const color = new THREE.Color(FLOW_COLORS[system.kind]);
      this.flowMesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(r, 12, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
        60,
      );
      this.flowMesh.renderOrder = 10;
      this.flowMesh.raycast = () => {};
      this.root.add(this.flowMesh);
    }
    this.applyMaterials();
  }

  // ---------- camera ----------

  fit(view: ViewName = "iso", animate = true, ids?: string[]): void {
    // Free tumbling can leave the camera rolled; framing always comes back upright.
    this.camera.up.set(0, 1, 0);
    const box = this.visibleBox(ids);
    const dir = VIEW_DIRS[view].clone().normalize();
    // Frame the model in the room the overlays leave free (flow bar, toolbar, step card).
    const h = Math.max(1, this.container.clientHeight);
    const free = this.snapping ? 1 : Math.max(0.35, (h - this.insets.top - this.insets.bottom) / h);
    const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * free);
    const { center, distance } = frameBox(box, dir, vfov, this.camera.aspect / free);
    const to = center.clone().add(dir.multiplyScalar(distance));
    if (animate && this.controls) {
      this.tween = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo: center, t: 0 };
    } else {
      this.camera.position.copy(to);
      this.camera.lookAt(center);
      this.controls?.target.copy(center);
    }
  }

  /** Room covered by overlays at the top and bottom of the view, in pixels. The picture is shifted to centre in what's left. */
  setInsets(top: number, bottom: number): void {
    if (top === this.insets.top && bottom === this.insets.bottom) return;
    this.insets = { top, bottom };
    this.applyViewOffset();
  }

  private applyViewOffset(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const { top, bottom } = this.insets;
    if (this.snapping || (!top && !bottom)) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, 0, (bottom - top) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  private visibleBox(ids?: string[]): THREE.Box3 {
    const box = new THREE.Box3();
    const pick = ids?.length ? ids : [...this.nodes.keys()];
    for (const id of pick) {
      const n = this.nodes.get(id);
      if (!n || !n.built || (!ids?.length && n.hideTarget === 1)) continue;
      const c = n.center.clone().add(this.offsetOf(n, this.explodeTarget));
      box.expandByPoint(c.clone().add(n.half));
      box.expandByPoint(c.clone().sub(n.half));
    }
    if (box.isEmpty()) {
      const s = this.meta?.device.sizeMm ?? [200, 200, 200];
      box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(...s));
    }
    // Zooming to one small part still keeps some of the machine around it in view.
    const min = this.deviceRadius * (ids?.length ? 0.38 : 0.15);
    const size = box.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) < min * 2) box.expandByScalar(min - Math.max(size.x, size.y, size.z) / 2);
    return box;
  }

  // ---------- labels ----------

  labelPoints(filter?: (p: Part) => boolean): LabelPoint[] {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const out: LabelPoint[] = [];
    const v = new THREE.Vector3();
    for (const n of this.nodes.values()) {
      if (!n.built || !n.group.visible || n.hideAnim > 0.5) continue;
      if (this.isolate && !this.inIsolation(n)) continue;
      if (filter && !filter(n.part)) continue;
      v.copy(n.center).add(n.group.position);
      if (this.clip.on && this.clipPlane.distanceToPoint(v) < -n.radius * 0.2) continue;
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      out.push({ id: n.id, name: n.part.name, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, depth: v.z, ok: n.ok });
    }
    return out;
  }

  /** Screen position of the model centre, for pushing labels outward. */
  screenCenter(): { x: number; y: number } {
    const v = this.visibleBox().getCenter(new THREE.Vector3()).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.container.clientWidth, y: (-v.y * 0.5 + 0.5) * this.container.clientHeight };
  }

  // ---------- snapshots ----------

  /** Render views to JPEG data URLs at a fixed size, restoring the live view afterwards. */
  snapshot(specs: { view: ViewName; explode?: number; clip?: boolean }[], width = 768, height = 576, background = "#efe9de"): string[] {
    const prev = {
      pos: this.camera.position.clone(),
      target: this.controls?.target.clone() ?? new THREE.Vector3(),
      explode: this.explode,
      explodeTarget: this.explodeTarget,
      clip: { ...this.clip },
      aspect: this.camera.aspect,
      size: this.renderer.getSize(new THREE.Vector2()),
      ratio: this.renderer.getPixelRatio(),
      bg: this.scene.background,
      edge: { color: this.edgeMat.color.clone(), opacity: this.edgeMat.opacity },
      system: this.system,
      selected: this.selected,
      hovered: this.hovered,
    };
    this.selected = null;
    this.hovered = null;
    this.playSystem(null);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.snapping = true;
    this.applyViewOffset();
    const bg = new THREE.Color(background);
    this.scene.background = bg;
    // Outlines contrast with whatever the picture sits on.
    this.edgeMat.color.set(bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5 ? "#e9e7e1" : "#1b1d22");
    this.edgeMat.opacity = 0.22;
    const out: string[] = [];
    for (const s of specs) {
      this.explode = this.explodeTarget = s.explode ?? 0;
      this.clip = { on: !!s.clip, axis: "x", t: 0 };
      this.updateClipPlane();
      this.applyMaterials();
      this.updatePositions(0);
      this.fit(s.view, false);
      this.camera.updateMatrixWorld();
      this.renderer.render(this.scene, this.camera);
      out.push(this.renderer.domElement.toDataURL("image/jpeg", 0.85));
    }
    this.scene.background = prev.bg;
    this.edgeMat.color.copy(prev.edge.color);
    this.edgeMat.opacity = prev.edge.opacity;
    this.renderer.setPixelRatio(prev.ratio);
    this.renderer.setSize(prev.size.x, prev.size.y, false);
    this.camera.aspect = prev.aspect;
    this.snapping = false;
    this.applyViewOffset();
    this.camera.position.copy(prev.pos);
    this.controls?.target.copy(prev.target);
    this.camera.lookAt(prev.target);
    this.explode = prev.explode;
    this.explodeTarget = prev.explodeTarget;
    this.clip = prev.clip;
    this.selected = prev.selected;
    this.hovered = prev.hovered;
    this.updateClipPlane();
    this.playSystem(prev.system);
    return out;
  }

  /** The current live view as a PNG (for "export view"). */
  capture(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  // ---------- internals ----------

  private inIsolation(n: Node): boolean {
    if (!this.isolate) return true;
    let cur: Node | undefined = n;
    while (cur) {
      if (cur.id === this.isolate) return true;
      cur = cur.part.parentId ? this.nodes.get(cur.part.parentId) : undefined;
    }
    return false;
  }

  private progress(order: number, t: number): number {
    return explodeProgress(order, this.maxOrder, t);
  }

  private offsetOf(n: Node, t: number): THREE.Vector3 {
    const out = new THREE.Vector3();
    let cur: Node | undefined = n;
    let guard = 0;
    while (cur && guard++ < 8) {
      out.addScaledVector(cur.own, this.progress(cur.part.explode.order, t));
      cur = cur.part.parentId ? this.nodes.get(cur.part.parentId) : undefined;
    }
    return out;
  }

  private updatePositions(dt: number): void {
    const step = dt > 0 ? Math.min(1, dt * 4) : 1;
    for (const n of this.nodes.values()) {
      if (n.hideAnim !== n.hideTarget) {
        n.hideAnim += Math.sign(n.hideTarget - n.hideAnim) * Math.min(Math.abs(n.hideTarget - n.hideAnim), dt > 0 ? dt * 2.2 : 1);
        this.applyNodeMaterial(n);
      }
      const off = this.offsetOf(n, this.explode);
      if (n.hideAnim > 0) {
        const dir = n.own.lengthSq() > 0 ? n.own.clone().normalize() : n.center.clone().normalize();
        if (dir.lengthSq() === 0) dir.set(0, 1, 0);
        off.addScaledVector(dir, this.deviceRadius * 0.9 * n.hideAnim * n.hideAnim);
      }
      n.group.position.lerp(off, step);
      n.group.visible = n.hideAnim < 0.98 && this.inIsolation(n);
    }
  }

  private updateClipPlane(): void {
    if (!this.clip.on) {
      this.clipPlane.set(new THREE.Vector3(-1, 0, 0), 1e7);
      return;
    }
    const i = { x: 0, y: 1, z: 2 }[this.clip.axis];
    const half = (this.meta?.device.sizeMm[i] ?? 200) / 2;
    const normal = new THREE.Vector3(i === 0 ? -1 : 0, i === 1 ? -1 : 0, i === 2 ? -1 : 0);
    // Keep everything on the negative side of the cut: the half facing the camera in iso is removed.
    this.clipPlane.set(normal, this.clip.t * half * 1.05);
  }

  private applyEdges(): void {
    for (const n of this.nodes.values()) for (const e of n.edges) e.visible = this.edgesOn;
  }

  private applyMaterials(): void {
    for (const n of this.nodes.values()) this.applyNodeMaterial(n);
  }

  private applyNodeMaterial(n: Node): void {
    const anyShell = [...this.nodes.values()].some((x) => x.part.shell);
    const inFlow = this.system ? this.system.path.includes(n.id) : true;
    let opacity = 1;
    if (this.xray && (anyShell ? n.part.shell : n.id !== this.selected)) opacity = anyShell ? 0.08 : 0.3;
    // Picking an inside part turns the outer covers to glass so it can be seen.
    const sel = this.selected ? this.nodes.get(this.selected) : undefined;
    if (sel && !sel.part.shell && n.part.shell && n.id !== sel.id) opacity = Math.min(opacity, 0.18);
    if (!inFlow) opacity = Math.min(opacity, 0.18);
    if (this.focus.size && !this.focus.has(n.id) && !this.system) opacity = Math.min(opacity, 0.55);
    opacity *= 1 - n.hideAnim;
    let glow = 0;
    if (this.focus.has(n.id)) glow = 0.22;
    if (this.hovered === n.id) glow = Math.max(glow, 0.18);
    if (this.selected === n.id) glow = 0.4;
    for (const m of n.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      const o = opacity * ((mat.userData.baseOpacity as number) ?? 1);
      const transparent = o < 0.999;
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = o;
      mat.depthWrite = o > 0.5;
      mat.emissive.copy(ACCENT).multiplyScalar(glow);
    }
    for (const e of n.edges) e.visible = this.edgesOn && opacity > 0.4;
  }

  private updateFlow(dt: number): void {
    if (!this.system || !this.flowMesh) return;
    const pts = this.system.path
      .map((id) => this.nodes.get(id))
      .filter((n): n is Node => !!n && n.built)
      .map((n) => n.center.clone().add(n.group.position));
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    this.flowT = (this.flowT + dt * 0.12) % 1;
    const m = new THREE.Matrix4();
    const count = this.flowMesh.count;
    for (let i = 0; i < count; i++) {
      const u = (i / count + this.flowT) % 1;
      m.makeTranslation(curve.getPointAt(u));
      this.flowMesh.setMatrixAt(i, m);
    }
    this.flowMesh.instanceMatrix.needsUpdate = true;
    if (!this.flowLine || Math.abs(this.explode - this.explodeTarget) > 1e-3 || this.flowLine.userData.n !== pts.length) {
      if (this.flowLine) {
        this.root.remove(this.flowLine);
        disposeObject(this.flowLine);
      }
      this.flowLine = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(32, pts.length * 24), this.deviceRadius * 0.004, 6, false),
        new THREE.MeshBasicMaterial({ color: (this.flowMesh.material as THREE.MeshBasicMaterial).color, transparent: true, opacity: 0.45, depthTest: false }),
      );
      this.flowLine.userData.n = pts.length;
      this.flowLine.renderOrder = 9;
      this.flowLine.raycast = () => {};
      this.root.add(this.flowLine);
    }
  }

  private last = performance.now();
  private loop = () => {
    if (this.disposed || this.paused || document.hidden) {
      // Hidden tab: check again shortly without drawing.
      if (!this.disposed && !this.paused) this.raf = requestAnimationFrame(() => setTimeout(this.loop, 250));
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.explode += (this.explodeTarget - this.explode) * Math.min(1, dt * 6);
    if (Math.abs(this.explodeTarget - this.explode) < 1e-4) this.explode = this.explodeTarget;
    this.updatePositions(dt);
    this.updateFlow(dt);
    if (this.tween && this.controls) {
      this.tween.t = Math.min(1, this.tween.t + dt * 1.8);
      const e = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
      this.controls.target.lerpVectors(this.tween.tFrom, this.tween.tTo, e);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.controls?.update();
    if (this.pointer.dirty && !this.drag) {
      this.pointer.dirty = false;
      const id = this.pick();
      if (id !== this.hovered) this.onHover(id);
      this.renderer.domElement.style.cursor = this.moveMode || id ? "grab" : "default";
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame();
  };

  /** Move tool: every drag slides the model, even on the background (for trackpads and small hands). */
  setMoveMode(on: boolean): void {
    this.moveMode = on;
  }

  /** Slide the camera and its target together by a screen-space drag, so the machine follows the pointer. */
  private slide(dx: number, dy: number): void {
    if (!this.controls) return;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / Math.max(1, this.container.clientHeight);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(-dx * perPx).add(up.multiplyScalar(dy * perPx));
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  /** Trackball-style turn: no stuck point at the top or bottom, the machine rolls over like a real object. */
  private tumble(dx: number, dy: number): void {
    if (!this.controls) return;
    const speed = (2 * Math.PI) / Math.max(1, this.container.clientHeight);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0).normalize();
    const up = this.camera.up.clone().normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(up, -dx * speed).multiply(new THREE.Quaternion().setFromAxisAngle(right, -dy * speed));
    const offset = this.camera.position.clone().sub(this.controls.target).applyQuaternion(q);
    this.camera.up.applyQuaternion(q).normalize();
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
  }

  /** Spin around a new point: the camera glides so that point becomes the centre, a little closer in. */
  lookAtPoint(point: THREE.Vector3): void {
    if (!this.controls) return;
    const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(0.7);
    this.tween = { from: this.camera.position.clone(), to: point.clone().add(offset), tFrom: this.controls.target.clone(), tTo: point.clone(), t: 0 };
  }

  private pick(): string | null {
    return this.hit()?.id ?? null;
  }

  private hit(): { id: string | null; point: THREE.Vector3 } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((this.pointer.x - rect.left) / rect.width) * 2 - 1, -((this.pointer.y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const n of this.nodes.values()) {
      if (!n.group.visible) continue;
      for (const m of n.meshes) if ((m.material as THREE.Material).opacity > 0.25) meshes.push(m);
    }
    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      if (this.clip.on && this.clipPlane.distanceToPoint(hit.point) < 0) continue;
      return { id: (hit.object.userData.partId as string) ?? null, point: hit.point };
    }
    return null;
  }

  private handleDouble = (e: MouseEvent) => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    const h = this.hit();
    if (h) this.lookAtPoint(h.point);
  };

  private handleMove = (e: PointerEvent) => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.dirty = true;
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.mode === "slide") this.slide(dx, dy);
    else this.tumble(dx, dy);
  };
  private handleDown = (e: PointerEvent) => {
    this.pointer.down = { x: e.clientX, y: e.clientY };
    this.pointers.add(e.pointerId);
    // A second finger hands over to OrbitControls' pinch and two-finger slide.
    if (this.pointers.size > 1) return void (this.drag = null);
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || !this.controls) return;
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.tween = null;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: this.moveMode || this.hit() ? "slide" : "tumble" };
    this.renderer.domElement.setPointerCapture(e.pointerId);
    if (this.drag.mode === "slide") this.renderer.domElement.style.cursor = "grabbing";
  };
  private handleUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.drag?.id === e.pointerId) {
      this.drag = null;
      this.pointer.dirty = true;
    }
    const d = this.pointer.down;
    this.pointer.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.onPick(this.pick());
  };
  private handleLeave = () => {
    this.onHover(null);
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyViewOffset();
  }

  private disposeNode(n: Node): void {
    this.root.remove(n.group);
    disposeObject(n.group);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("dblclick", this.handleDouble);
    el.removeEventListener("pointermove", this.handleMove);
    el.removeEventListener("pointerdown", this.handleDown);
    el.removeEventListener("pointerup", this.handleUp);
    el.removeEventListener("pointercancel", this.handleUp);
    el.removeEventListener("pointerleave", this.handleLeave);
    this.controls?.dispose();
    for (const n of this.nodes.values()) this.disposeNode(n);
    this.playSystem(null);
    this.edgeMat.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    // Release the GL context now; browsers cap how many can be alive at once.
    this.renderer.forceContextLoss();
    el.remove();
  }
}

function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    // The shared edge material is disposed with the engine.
    else if (mat && !(mat instanceof THREE.LineBasicMaterial && !(mat instanceof THREE.LineDashedMaterial))) mat.dispose();
  });
}
