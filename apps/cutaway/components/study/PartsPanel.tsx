"use client";

import { ChevronRight, Eye, EyeOff, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildResult } from "@/components/viewer/Viewer3D";
import type { Meta, Part } from "@/lib/schema/teardown";
import { partNumbers } from "@/lib/ui/words";
import styles from "./study.module.css";

type Props = {
  meta: Meta;
  selected: string | null;
  hovered: string | null;
  opened: string[];
  results: Record<string, BuildResult>;
  hidden: string[];
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onHide: (ids: string[], hide: boolean) => void;
};

export function PartsPanel(p: Props) {
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const children = useMemo(() => {
    const m = new Map<string | null, Part[]>();
    const ids = new Set(p.meta.parts.map((x) => x.id));
    for (const part of p.meta.parts) {
      const k = part.parentId && ids.has(part.parentId) ? part.parentId : null;
      m.set(k, [...(m.get(k) ?? []), part]);
    }
    return m;
  }, [p.meta.parts]);
  const numbers = useMemo(() => partNumbers(p.meta.parts), [p.meta.parts]);
  const byId = useMemo(() => new Map(p.meta.parts.map((x) => [x.id, x])), [p.meta.parts]);
  const groups = useMemo(() => p.meta.parts.filter((x) => children.has(x.id)).map((x) => x.id), [p.meta.parts, children]);
  const opened = new Set(p.opened);
  const hidden = new Set(p.hidden);
  const found = p.meta.parts.filter((x) => opened.has(x.id)).length;
  const total = p.meta.parts.length;
  const ql = q.trim().toLowerCase();
  const matches = (x: Part) => !ql || `${x.name} ${x.material} ${x.function} ${numbers.get(x.id)}`.toLowerCase().includes(ql);
  const withInside = (id: string): string[] => [id, ...(children.get(id) ?? []).flatMap((k) => withInside(k.id))];

  // Long lists start folded so a first look isn't a wall of 30 names; the picked part's group always opens.
  const [open, setOpen] = useState<Set<string>>(() => new Set(total > 14 ? [] : groups));
  const forced = new Set<string>();
  for (let id = p.selected ? byId.get(p.selected)?.parentId : null; id; id = byId.get(id)?.parentId) forced.add(id);
  const setGroup = (id: string, on: boolean) =>
    setOpen((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const allOpen = groups.every((g) => open.has(g));

  // Picking a part on the model scrolls the list to it.
  useEffect(() => {
    if (!p.selected) return;
    const t = setTimeout(() => listRef.current?.querySelector(`[data-id="${CSS.escape(p.selected!)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [p.selected]);

  // Up and down arrows walk the list without the mouse.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const count = (part: Part): [number, number] =>
    (children.get(part.id) ?? []).reduce<[number, number]>(
      (acc, k) => {
        const [f, t] = count(k);
        return [acc[0] + f + (opened.has(k.id) ? 1 : 0), acc[1] + t + 1];
      },
      [0, 0],
    );

  const row = (part: Part, depth: number): React.ReactNode => {
    const kids = children.get(part.id) ?? [];
    const kidHit = (k: Part): boolean => matches(k) || (children.get(k.id) ?? []).some(kidHit);
    if (!matches(part) && !kids.some(kidHit)) return null;
    const r = p.results[part.id];
    const expanded = !!ql || open.has(part.id) || forced.has(part.id);
    const [kf, kt] = kids.length ? count(part) : [0, 0];
    const isHidden = hidden.has(part.id);
    return (
      <div key={part.id}>
        <div className={styles.partLine} data-hidden={isHidden} style={{ paddingLeft: depth * 16 }}>
          {kids.length ? (
            <button className={styles.fold} data-open={expanded} onClick={() => setGroup(part.id, !expanded)} aria-label={`${expanded ? "Fold away" : "Show"} the ${kt} parts inside ${part.name}`} aria-expanded={expanded}>
              <ChevronRight size={16} />
            </button>
          ) : (
            <span className={styles.foldSpace} />
          )}
          <button
            className={styles.partRow}
            data-row
            data-id={part.id}
            data-selected={p.selected === part.id}
            data-hovered={p.hovered === part.id}
            data-seen={opened.has(part.id)}
            data-group={kids.length > 0}
            onClick={() => {
              p.onSelect(part.id);
              if (kids.length) setGroup(part.id, true);
            }}
            onMouseEnter={() => p.onHover(part.id)}
            onMouseLeave={() => p.onHover(null)}
          >
            <span className={styles.partNo}>{numbers.get(part.id)}</span>
            <span className={styles.swatch} style={{ background: r?.color ?? "var(--line-2)" }} />
            <span className={styles.partName}>{part.name}</span>
            {r && !r.ok ? (
              <span className={styles.partFail}>didn&apos;t build</span>
            ) : kids.length ? (
              <span className={styles.kidCount} title={`${kf} of the ${kt} parts inside found`}>
                {kf}/{kt}
              </span>
            ) : opened.has(part.id) ? (
              <span className={styles.seen} aria-label="Found">
                ✓
              </span>
            ) : null}
          </button>
          <button
            className={styles.eye}
            data-on={isHidden}
            onClick={() => p.onHide(withInside(part.id), !isHidden)}
            aria-label={`${isHidden ? "Show" : "Hide"} ${part.name}${kids.length ? " and the parts inside it" : ""}`}
            title={isHidden ? "Show it again" : kids.length ? "Hide it and the parts inside" : "Hide it to see behind"}
          >
            {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {expanded && kids.map((k) => row(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className={styles.partsWrap}>
      <div className={styles.partsHead}>
        <div className={styles.partsTitle}>
          <h2>Parts</h2>
          <span>{found === total ? "All found" : `${found} / ${total} found`}</span>
        </div>
        <div className={styles.meter}>
          <span style={{ width: `${(found / Math.max(1, total)) * 100}%` }} />
        </div>
        <label className={styles.search}>
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a part by name or number" aria-label="Find a part" />
        </label>
        <div className={styles.listTools}>
          {groups.length > 0 && !ql && (
            <button onClick={() => setOpen(allOpen ? new Set() : new Set(groups))}>{allOpen ? "Fold all" : "Open all"}</button>
          )}
          {p.hidden.length > 0 && (
            <button className={styles.showAll} onClick={() => p.onHide(p.hidden, false)}>
              <Eye size={14} /> Show {p.hidden.length} hidden
            </button>
          )}
        </div>
      </div>
      <div ref={listRef} className={`${styles.partsList} scroll`} onKeyDown={onKeyDown}>
        {(children.get(null) ?? []).map((part) => row(part, 0))}
      </div>
    </div>
  );
}
