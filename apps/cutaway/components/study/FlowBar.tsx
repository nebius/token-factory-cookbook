"use client";

import { X } from "lucide-react";
import type { FlowSystem, Part } from "@/lib/schema/teardown";
import { FLOW_COLORS } from "@/lib/viewer/engine";
import { FLOW_WORDS } from "@/lib/ui/words";
import styles from "./study.module.css";

/** Play how electricity, air, heat or motion moves through the machine. */
export function FlowBar({ systems, active, onPlay, parts, onSelect }: { systems: FlowSystem[]; active: FlowSystem | null; onPlay: (s: FlowSystem | null) => void; parts: Map<string, Part>; onSelect: (id: string) => void }) {
  return (
    <div className={styles.flowWrap}>
      <div className={styles.flowBar} data-inset="top">
        <span className={styles.flowLabel}>Watch it work</span>
        {systems.map((s) => (
          <button key={s.id} className={styles.flowChip} data-on={active?.id === s.id} onClick={() => onPlay(active?.id === s.id ? null : s)} title={FLOW_WORDS[s.kind].verb}>
            <span className={styles.flowDot} style={{ background: FLOW_COLORS[s.kind] }} />
            {s.name}
          </button>
        ))}
      </div>
      {active && (
        <div key={active.id} className={styles.flowCard}>
          <button className={styles.flowClose} onClick={() => onPlay(null)} aria-label="Stop">
            <X size={15} />
          </button>
          <div className={styles.eyebrow} style={{ color: FLOW_COLORS[active.kind] }}>
            {FLOW_WORDS[active.kind].label}
          </div>
          <div className={styles.flowName}>{active.name}</div>
          <p>{active.explanation}</p>
          <div className={styles.flowPath}>
            {active.path.map((id, i) => (
              <span key={id}>
                {i > 0 && <span className={styles.flowArrow}>→</span>}
                <button onClick={() => onSelect(id)}>{parts.get(id)?.name ?? id}</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
