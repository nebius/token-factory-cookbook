"use client";

import { Download, PencilRuler } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Diagram, Meta } from "@/lib/schema/teardown";
import styles from "./study.module.css";

type Props = {
  diagrams: Diagram[];
  meta: Meta;
  selected: string | null;
  hovered: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
};

const KINDS: Record<string, { label: string; text: string }> = {
  section: { label: "Cut in half", text: "The machine sliced down the middle, seen from the side." },
  flow: { label: "How it works map", text: "Boxes are parts. Arrows show how electricity, air, heat or motion moves between them." },
  callouts: { label: "Numbered parts", text: "The machine pulled apart, with every part numbered." },
};
const ORDER = ["section", "flow", "callouts"];

export function Drawings(p: Props) {
  const list = useMemo(() => [...p.diagrams].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)), [p.diagrams]);
  const [kind, setKind] = useState(list[0]?.kind ?? "section");
  const [clean, setClean] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(p);
  cb.current = p;
  const current = list.find((d) => d.kind === kind) ?? list[0];

  // Model-written SVG is sanitised in the browser before it is shown.
  useEffect(() => {
    let alive = true;
    if (!current) return;
    void import("dompurify").then(({ default: DOMPurify }) => {
      if (alive) setClean(DOMPurify.sanitize(current.svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_ATTR: ["data-part"], FORBID_TAGS: ["foreignObject", "image", "a"] }));
    });
    return () => {
      alive = false;
    };
  }, [current]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest("[data-part]")?.getAttribute("data-part") ?? null) : null);
    const over = (e: MouseEvent) => cb.current.onHover(find(e.target));
    const leave = () => cb.current.onHover(null);
    const click = (e: MouseEvent) => {
      const id = find(e.target);
      if (id) cb.current.onSelect(id);
    };
    el.addEventListener("mouseover", over);
    el.addEventListener("mouseleave", leave);
    el.addEventListener("click", click);
    return () => {
      el.removeEventListener("mouseover", over);
      el.removeEventListener("mouseleave", leave);
      el.removeEventListener("click", click);
    };
  }, []);

  if (!current) {
    return (
      <div className={styles.emptyStage}>
        <PencilRuler size={30} />
        <b>No drawings for this machine yet.</b>
      </div>
    );
  }

  const ids = new Set(p.meta.parts.map((x) => x.id));
  const hi = [p.selected, p.hovered].filter((x): x is string => !!x && ids.has(x));
  const words = KINDS[current.kind] ?? { label: current.title, text: "" };

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([current.svg], { type: "image/svg+xml" }));
    a.download = `${p.meta.device.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${current.kind}.svg`;
    a.click();
  };

  return (
    <div className={styles.drawings}>
      <div className={styles.drawBar}>
        <div className="seg">
          {list.map((d) => (
            <button key={d.kind} aria-pressed={d.kind === current.kind} onClick={() => setKind(d.kind)}>
              {KINDS[d.kind]?.label ?? d.title}
            </button>
          ))}
        </div>
        <button className="btn btn-sm" onClick={download} style={{ marginLeft: "auto" }}>
          <Download size={15} /> Download
        </button>
      </div>
      <div className={`${styles.drawCanvas} scroll`}>
        <div className={styles.drawHelp}>
          <b>{current.title}</b> · {words.text} Point at a name to light it up, or tap it to learn about that part.
        </div>
        {hi.length > 0 && <style>{`${hi.map((id) => `[data-part="${id}"]`).join(",")}{color:var(--hi)!important;}${hi.map((id) => `[data-part="${id}"] *`).join(",")}{stroke-width:2.2px;}`}</style>}
        <div ref={ref} className={styles.svgHost} dangerouslySetInnerHTML={{ __html: clean }} />
      </div>
    </div>
  );
}
