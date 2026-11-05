"use client";

import * as Slider from "@radix-ui/react-slider";
import { Hand, Move, RotateCcw, Scissors, ScanEye, Tag } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tip } from "@/components/ui/Tip";
import { runParts } from "@/lib/sandbox/run";
import type { BuiltPart, Issue } from "@/lib/sandbox/types";
import type { FlowSystem, Meta, ViewName } from "@/lib/schema/teardown";
import { partNumbers } from "@/lib/ui/words";
import { TeardownEngine, type ClipAxis } from "@/lib/viewer/engine";
import styles from "./viewer.module.css";

export type BuildResult = { id: string; ok: boolean; issues: Issue[]; triangles: number; color?: string };
export type LabelMode = "off" | "main" | "all";

export type ViewerProps = {
  meta: Meta;
  parts: { id: string; code: string }[];
  selected?: string | null;
  hovered?: string | null;
  onSelect?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  focus?: string[];
  hidden?: string[];
  system?: FlowSystem | null;
  isolate?: string | null;
  view?: { name: ViewName; ids?: string[]; nonce: number } | null;
  /** Ask the viewer to set the explode amount (e.g. from a "Take it apart" button). */
  explodeRequest?: { value: number; nonce: number } | null;
  toolbar?: boolean;
  /** Reframe the full saved model after the disassembly slider is committed. */
  frameOnDisassembly?: boolean;
  keyboard?: boolean;
  /** False while the viewer is hidden behind another tab; rendering pauses. */
  active?: boolean;
  hint?: boolean;
  initialExplode?: number;
  initialLabels?: LabelMode;
  onPartBuilt?: (r: BuildResult) => void;
  onBuildDone?: (results: BuildResult[]) => void;
  onEngine?: (e: TeardownEngine | null) => void;
  children?: React.ReactNode;
};

type Label = { el: HTMLButtonElement; line: SVGLineElement; dot: SVGCircleElement };

/** The colour a person would call this part: the material of its biggest mesh. */
function mainColor(p: BuiltPart): string | undefined {
  let best: BuiltPart["meshes"][number] | undefined;
  for (const m of p.meshes) if (!best || m.position.length > best.position.length) best = m;
  return best?.material.color;
}

export function Viewer3D(p: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<TeardownEngine | null>(null);
  const builtCodes = useRef(new Map<string, string>());
  const labelEls = useRef(new Map<string, Label>());
  const cb = useRef(p);
  cb.current = p;

  const [ready, setReady] = useState(false);
  const [glError, setGlError] = useState(false);
  const [explode, setExplode] = useState(p.initialExplode ?? 0);
  const [clip, setClip] = useState<{ on: boolean; axis: ClipAxis; t: number }>({ on: false, axis: "x", t: 0 });
  const [xray, setXray] = useState(false);
  const [move, setMove] = useState(false);
  const [labels, setLabels] = useState<LabelMode>(p.initialLabels ?? "main");
  const [building, setBuilding] = useState<{ done: number; total: number } | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const labelsMode = useRef(labels);
  const numbers = useRef(partNumbers(p.meta.parts));
  numbers.current = partNumbers(p.meta.parts);
  labelsMode.current = labels;

  useEffect(() => {
    if (window.innerWidth < 700) setLabels("off");
    // The first-visit tour already says how to spin and zoom, so the hint waits until the tour has been seen
    // (or never comes, on small screens), then fades by itself.
    if (p.hint) {
      try {
        if (!localStorage.getItem("cutaway-hint-done") && (localStorage.getItem("cutaway-tour-done") || window.innerWidth <= 900)) setShowHint(true);
      } catch {
        /* no storage: skip the hint */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!showHint) return;
    const t = setTimeout(dismissHint, 7000);
    return () => clearTimeout(t);
  }, [showHint]);
  const userMoved = useRef(false);
  const pointerIn = useRef(false);
  const onUserMove = () => {
    userMoved.current = true;
    dismissHint();
  };
  const dismissHint = () => {
    if (!showHint) return;
    setShowHint(false);
    try {
      localStorage.setItem("cutaway-hint-done", "1");
    } catch {
      /* ignore */
    }
  };

  // ---------- engine lifecycle ----------
  useEffect(() => {
    const host = hostRef.current!;
    let engine: TeardownEngine;
    try {
      engine = new TeardownEngine(host, { interactive: true, preserveDrawingBuffer: true });
    } catch {
      setGlError(true);
      return;
    }
    engineRef.current = engine;
    engine.onHover = (id) => cb.current.onHover?.(id);
    engine.onPick = (id) => cb.current.onSelect?.(id);
    engine.onFrame = () => drawLabels();
    setReady(true);
    cb.current.onEngine?.(engine);
    return () => {
      cb.current.onEngine?.(null);
      engine.dispose();
      engineRef.current = null;
      builtCodes.current.clear();
      labelEls.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- model + builds ----------
  const metaIds = p.meta.parts.map((x) => x.id).join("|");
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setModel(p.meta);
    userMoved.current = false;
    builtCodes.current.clear();
    for (const l of labelEls.current.values()) {
      l.el.remove();
      l.line.remove();
      l.dot.remove();
    }
    labelEls.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, metaIds, p.meta.device.sizeMm.join(",")]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    for (const part of p.meta.parts) e.updatePartMeta(part);
  }, [p.meta]);

  const buildSeq = useRef(0);
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !ready) return;
    const known = new Set(p.meta.parts.map((x) => x.id));
    const todo = p.parts.filter((x) => known.has(x.id) && builtCodes.current.get(x.id) !== x.code);
    if (!todo.length) return;
    for (const t of todo) builtCodes.current.set(t.id, t.code);
    const seq = ++buildSeq.current;
    let done = 0;
    setBuilding({ done: 0, total: todo.length });
    const colors = new Map<string, string | undefined>();
    void runParts(todo, p.meta.device.sizeMm, (part: BuiltPart) => {
      if (engineRef.current !== e) return;
      const color = mainColor(part);
      colors.set(part.id, color);
      cb.current.onPartBuilt?.({ id: part.id, ok: part.ok, issues: part.issues, triangles: part.triangles, color });
      e.setPart(part);
      done++;
      if (seq === buildSeq.current) setBuilding({ done, total: todo.length });
    }).then((all) => {
      if (engineRef.current !== e) return;
      if (seq === buildSeq.current) setBuilding(null);
      // The first framing used the overall size; now frame what was actually built, unless the camera was moved.
      if (!userMoved.current) e.fit(cb.current.view?.name ?? "iso", true, cb.current.view?.ids);
      cb.current.onBuildDone?.(all.map((x) => ({ id: x.id, ok: x.ok, issues: x.issues, triangles: x.triangles, color: colors.get(x.id) })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, metaIds, p.parts]);

  // ---------- controlled state ----------
  useEffect(() => engineRef.current?.setExplode(explode), [explode, ready]);
  useEffect(() => engineRef.current?.setClip(clip.on, clip.axis, clip.t), [clip, ready]);
  useEffect(() => engineRef.current?.setXray(xray), [xray, ready]);
  useEffect(() => engineRef.current?.setMoveMode(move), [move, ready]);
  // The stage is always light sky paper, in either theme, so outlines stay dark.
  useEffect(() => engineRef.current?.setTheme(false), [ready]);
  useEffect(() => engineRef.current?.setPaused(p.active === false), [p.active, ready]);
  useEffect(() => engineRef.current?.setSelected(p.selected ?? null), [p.selected, ready]);
  useEffect(() => engineRef.current?.setHovered(p.hovered ?? null), [p.hovered, ready]);
  useEffect(() => engineRef.current?.setFocus(p.focus ?? []), [p.focus, ready]);
  useEffect(() => engineRef.current?.setHidden(p.hidden ?? []), [p.hidden, ready]);
  useEffect(() => engineRef.current?.setIsolate(p.isolate ?? null), [p.isolate, ready]);
  useEffect(() => engineRef.current?.playSystem(p.system ?? null), [p.system, ready]);
  useEffect(() => {
    if (p.view) engineRef.current?.fit(p.view.name, true, p.view.ids);
  }, [p.view, ready]);
  useEffect(() => {
    if (!p.explodeRequest) return;
    setExplode(p.explodeRequest.value);
    engineRef.current?.setExplode(p.explodeRequest.value);
    engineRef.current?.fit("iso");
  }, [p.explodeRequest]);

  // ---------- labels (DOM updated every frame, no React renders) ----------
  const drawLabels = useCallback(() => {
    const e = engineRef.current;
    const box = labelsRef.current;
    const svg = svgRef.current;
    if (!e || !box || !svg) return;
    const mode = labelsMode.current;
    const pts = e.labelPoints((part) => {
            // The picked or pointed-at part always gets its name tag, even with tags off.
            // (Pointed at in the 3D view, the cursor tip already names it.)
            if (part.id === cb.current.selected || (part.id === cb.current.hovered && !pointerIn.current)) return true;
            // A step's "look at" parts and a playing flow's parts are always named, so the words match the picture.
            if (cb.current.focus?.includes(part.id) || cb.current.system?.path.includes(part.id)) return true;
            if (mode === "off") return false;
            // While a flow plays or a step is shown, only the parts it is about get a name tag.
            if (cb.current.system) return cb.current.system.path.includes(part.id);
            if (cb.current.focus?.length) return cb.current.focus.includes(part.id);
            return mode === "all" || !part.parentId;
          });
    const keep = new Set<string>();
    const w = box.clientWidth;
    const c = e.screenCenter();
    const placed = pts.map((pt) => {
      const dx = pt.x - c.x;
      const dy = pt.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      return { pt, side: dx >= 0 ? 1 : -1, lx: pt.x + (dx / len) * 50, ly: pt.y + (dy / len) * 50 };
    });
    for (const side of [1, -1]) {
      const group = placed.filter((q) => q.side === side).sort((a, b) => a.ly - b.ly);
      for (let i = 1; i < group.length; i++) if (group[i].ly - group[i - 1].ly < 26) group[i].ly = group[i - 1].ly + 26;
    }
    for (const q of placed) {
      const { pt } = q;
      keep.add(pt.id);
      let l = labelEls.current.get(pt.id);
      if (!l) {
        const el = document.createElement("button");
        el.className = styles.label;
        const no = document.createElement("span");
        no.className = styles.labelNo;
        el.appendChild(no);
        el.appendChild(document.createElement("span"));
        el.onclick = () => cb.current.onSelect?.(el.dataset.id ?? null);
        el.onmouseenter = () => cb.current.onHover?.(el.dataset.id ?? null);
        el.onmouseleave = () => cb.current.onHover?.(null);
        box.appendChild(el);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("r", "3");
        svg.appendChild(line);
        svg.appendChild(dot);
        l = { el, line, dot };
        labelEls.current.set(pt.id, l);
      }
      const state = pt.id === cb.current.selected ? "sel" : pt.id === cb.current.hovered ? "hov" : pt.ok ? "" : "err";
      if (l.el.dataset.id !== pt.id) l.el.dataset.id = pt.id;
      const text = pt.ok ? pt.name : `${pt.name} (couldn't build)`;
      const [noEl, nameEl] = l.el.children as unknown as [HTMLElement, HTMLElement];
      const no = String(numbers.current.get(pt.id) ?? "");
      if (noEl.textContent !== no) noEl.textContent = no;
      if (nameEl.textContent !== text) nameEl.textContent = text;
      l.el.dataset.state = state;
      const lx = Math.max(8, Math.min(w - 8, q.lx));
      l.el.style.transform = `translate(${lx}px, ${q.ly}px) translate(${q.side > 0 ? "0" : "-100%"}, -50%)`;
      l.el.style.display = "";
      l.line.setAttribute("x1", String(pt.x));
      l.line.setAttribute("y1", String(pt.y));
      l.line.setAttribute("x2", String(lx));
      l.line.setAttribute("y2", String(q.ly));
      l.line.dataset.state = state;
      l.dot.setAttribute("cx", String(pt.x));
      l.dot.setAttribute("cy", String(pt.y));
      l.dot.dataset.state = state;
      l.line.style.display = l.dot.style.display = "";
    }
    for (const [id, l] of labelEls.current) {
      if (!keep.has(id)) {
        l.el.style.display = "none";
        l.line.style.display = l.dot.style.display = "none";
      }
    }
  }, []);

  // ---------- overlays ----------
  // The flow bar, toolbar and step card cover the top and bottom of the view; frame the model in the space between.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const e = engineRef.current;
    if (!wrap || !e) return;
    const measure = () => {
      const r = wrap.getBoundingClientRect();
      if (!r.height) return;
      let top = 0;
      let bottom = 0;
      for (const el of wrap.querySelectorAll<HTMLElement>("[data-inset]")) {
        const b = el.getBoundingClientRect();
        if (!b.height) continue;
        if (el.dataset.inset === "top") top = Math.max(top, b.bottom - r.top);
        else bottom = Math.max(bottom, r.bottom - b.top);
      }
      e.setInsets(Math.round(top), Math.round(bottom));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    for (const el of wrap.querySelectorAll("[data-inset]")) ro.observe(el);
    return () => ro.disconnect();
  }, [ready, p.toolbar, p.children]);

  // ---------- keyboard ----------
  useEffect(() => {
    if (!p.keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=slider]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "e") {
        setExplode((x) => (x > 0.5 ? 0 : 1));
        engineRef.current?.fit("iso");
      } else if (k === "x") setXray((x) => !x);
      else if (k === "m") setMove((m) => !m);
      else if (k === "c") setClip((c) => ({ ...c, on: !c.on }));
      else if (k === "l") setLabels((m) => (m === "off" ? "main" : m === "main" ? "all" : "off"));
      else if (k === "f") engineRef.current?.fit("iso", true, cb.current.selected ? [cb.current.selected] : undefined);
      else return;
      userMoved.current = true;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.keyboard]);

  const hoveredName = p.hovered ? p.meta.parts.find((x) => x.id === p.hovered)?.name : null;
  const resetView = () => {
    setClip((c) => ({ ...c, on: false }));
    setXray(false);
    setMove(false);
    engineRef.current?.fit("iso");
  };

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} stage-surface`}
      data-move={move}
      onPointerDown={onUserMove}
      onWheel={onUserMove}
      onPointerEnter={() => (pointerIn.current = true)}
      onPointerMove={(e) => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (r) setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onPointerLeave={() => {
        pointerIn.current = false;
        setCursor(null);
      }}
      data-tour="viewer"
    >
      <div ref={hostRef} className={styles.host} />
      <svg ref={svgRef} className={styles.lines} aria-hidden="true" />
      <div ref={labelsRef} className={styles.labels} />

      {hoveredName && cursor && p.hovered !== p.selected && (
        <div className={styles.cursorTip} style={{ transform: `translate(${cursor.x + 16}px, ${cursor.y + 14}px)` }}>
          <b>{hoveredName}</b>
          <span>Click to learn about it</span>
        </div>
      )}

      {glError && <div className={styles.glError}>3D needs WebGL, which this browser has turned off or run out of. Reload the page, or turn on hardware acceleration.</div>}

      <AnimatePresence>
        {showHint && ready && (
          <motion.div className={styles.hint} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
            <motion.span animate={{ x: [-10, 10, -10] }} transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}>
              <Hand size={30} />
            </motion.span>
            <div>
              <b>Grab the machine to move it</b>
              <span>Drag the background to turn it any way · scroll to zoom where you point · double-click to look closer</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {building && (
        <div className={styles.building}>
          <span className={styles.buildBar} style={{ width: `${(building.done / Math.max(1, building.total)) * 100}%` }} />
          Building parts {building.done} of {building.total}
        </div>
      )}

      {p.children}

      {p.toolbar !== false && (
        <div className={`${styles.dock} no-print`} data-inset="bottom">
          <div className={styles.apart} data-tour="apart">
            <span className={styles.apartEnd}>Together</span>
            <Slider.Root className="slider" min={0} max={1} step={0.01} value={[explode]} onValueChange={([v]) => setExplode(v)} onValueCommit={p.frameOnDisassembly ? ([v]) => { engineRef.current?.setExplode(v); engineRef.current?.fit("iso"); } : undefined} aria-label="Take it apart">
              <Slider.Track className="slider-track">
                <Slider.Range className="slider-range" />
              </Slider.Track>
              <Slider.Thumb className="slider-thumb" aria-label="Take it apart" />
            </Slider.Root>
            <span className={styles.apartEnd}>Apart</span>
          </div>
          <span className={styles.sep} />
          <Tip title="Move" text="Every drag slides the machine, even on the background. Without this, grab the machine itself to slide it. (M)">
            <button className={styles.tool} data-on={move} onClick={() => setMove((m) => !m)} aria-pressed={move}>
              <Move size={19} />
              <span>Move</span>
            </button>
          </Tip>
          <Tip title="Slice open" text="Cut the machine in half so you can see inside, like slicing a cake. (C)">
            <button className={styles.tool} data-on={clip.on} onClick={() => setClip((c) => ({ ...c, on: !c.on }))}>
              <Scissors size={19} />
              <span>Slice</span>
            </button>
          </Tip>
          <Tip title="See through" text="Make the outside covers glassy so you can see the parts inside. (X)">
            <button className={styles.tool} data-on={xray} onClick={() => setXray((x) => !x)}>
              <ScanEye size={19} />
              <span>See through</span>
            </button>
          </Tip>
          <Tip title="Name tags" text="Show the names of the parts. Tap again for every part, and again to hide them. (L)">
            <button className={styles.tool} data-on={labels !== "off"} onClick={() => setLabels((m) => (m === "off" ? "main" : m === "main" ? "all" : "off"))}>
              <Tag size={19} />
              <span>{labels === "all" ? "All names" : "Names"}</span>
            </button>
          </Tip>
          <Tip title="Start over" text="Put the camera back and turn off slice and see-through.">
            <button className={styles.tool} onClick={resetView}>
              <RotateCcw size={19} />
              <span>Reset</span>
            </button>
          </Tip>
        </div>
      )}

      {clip.on && p.toolbar !== false && (
        <div className={`${styles.sliceBar} no-print`} data-inset="bottom">
          <span>Slice direction</span>
          <div className={styles.axis}>
            {(
              [
                ["x", "Side"],
                ["y", "Top"],
                ["z", "Front"],
              ] as [ClipAxis, string][]
            ).map(([a, label]) => (
              <button key={a} data-on={clip.axis === a} onClick={() => setClip((c) => ({ ...c, axis: a }))}>
                {label}
              </button>
            ))}
          </div>
          <span>Move the cut</span>
          <Slider.Root className="slider" style={{ width: 140 }} min={-1} max={1} step={0.01} value={[clip.t]} onValueChange={([v]) => setClip((c) => ({ ...c, t: v }))} aria-label="Move the cut">
            <Slider.Track className="slider-track">
              <Slider.Range className="slider-range" />
            </Slider.Track>
            <Slider.Thumb className="slider-thumb" aria-label="Move the cut" />
          </Slider.Root>
        </div>
      )}
    </div>
  );
}
