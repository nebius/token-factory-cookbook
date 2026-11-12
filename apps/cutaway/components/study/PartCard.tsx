"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { BuildResult } from "@/components/viewer/Viewer3D";
import { ReadAloud } from "@/components/ui/ReadAloud";
import { Tip } from "@/components/ui/Tip";
import type { FlowSystem, Meta, Part } from "@/lib/schema/teardown";
import { FLOW_COLORS } from "@/lib/viewer/engine";
import { CONFIDENCE_WORDS, FLOW_WORDS } from "@/lib/ui/words";
import styles from "./study.module.css";

type Props = {
  part: Part;
  meta: Meta;
  expert: boolean;
  result?: BuildResult;
  colors: Record<string, BuildResult>;
  note: string;
  onNote: (body: string) => void;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  isolated: boolean;
  onIsolate: () => void;
  onZoom: () => void;
  onPlay: (s: FlowSystem) => void;
  prevId: string | null;
  nextId: string | null;
  onExpert: () => void;
};

export function PartCard(p: Props) {
  const { part, meta } = p;
  const byId = new Map(meta.parts.map((x) => [x.id, x]));
  const parent = part.parentId ? byId.get(part.parentId) : null;
  const kids = meta.parts.filter((x) => x.parentId === part.id);
  const systems = meta.systems.filter((s) => s.path.includes(part.id));
  const neighbours = systems.flatMap((s) => {
    const i = s.path.indexOf(part.id);
    return [s.path[i - 1], s.path[i + 1]].filter((x): x is string => !!x && x !== part.id);
  });
  const friends = [...new Set([...kids.map((k) => k.id), ...neighbours])].filter((id) => byId.has(id));
  const conf = CONFIDENCE_WORDS[part.confidence];
  const hasExpert = !!part.engineering || part.specs.length > 0 || part.failureModes.length > 0;

  return (
    <div className={`${styles.panel} scroll`}>
      <div className={styles.cardNav}>
        <button className={styles.textBtn} onClick={p.onClose}>
          <ArrowLeft size={15} /> All parts
        </button>
        <span className={styles.navArrows}>
          <button onClick={() => p.prevId && p.onSelect(p.prevId)} disabled={!p.prevId} aria-label="Previous part">
            <ArrowLeft size={16} />
          </button>
          <button onClick={() => p.nextId && p.onSelect(p.nextId)} disabled={!p.nextId} aria-label="Next part">
            <ArrowRight size={16} />
          </button>
        </span>
      </div>

      <div className={styles.eyebrow}>
        No. {p.meta.parts.findIndex((x) => x.id === part.id) + 1}
        {parent ? (
          <>
            {" "}· Part of the{" "}
            <button className={styles.inlineLink} onClick={() => p.onSelect(parent.id)}>
              {parent.name}
            </button>
          </>
        ) : null}
      </div>
      <h2 className={styles.partTitle}>
        <span className={styles.swatchBig} style={{ background: p.result?.color ?? "var(--line-2)" }} />
        {part.name}
      </h2>
      <div className={styles.metaLine}>
        {part.material} ·{" "}
        <Tip text={conf.hint}>
          <span className={styles.conf} data-level={part.confidence}>
            {conf.label}
          </span>
        </Tip>
      </div>

      {p.result && !p.result.ok && <p className={styles.err}>Kimi&apos;s 3D design for this part didn&apos;t work, so it shows as a dashed box. ({p.result.issues[0]?.message})</p>}

      <p className={styles.lead}>{part.function}</p>
      <p className={styles.body}>{part.howItWorks}</p>

      <div className={styles.actions}>
        <ReadAloud text={`${part.name}. ${part.function} ${part.howItWorks}`} />
        <button className="btn btn-sm" onClick={p.onZoom}>
          Zoom in
        </button>
        <button className="btn btn-sm" onClick={p.onIsolate} aria-pressed={p.isolated}>
          {p.isolated ? "Show everything" : "Show only this"}
        </button>
      </div>

      {friends.length > 0 && (
        <div className={styles.block}>
          <div className={styles.eyebrow}>Works with</div>
          <div className={styles.friends}>
            {friends.map((id) => (
              <button key={id} className={styles.friend} onClick={() => p.onSelect(id)}>
                <span>{p.meta.parts.findIndex((x) => x.id === id) + 1}</span>
                {byId.get(id)?.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {systems.length > 0 && (
        <div className={styles.block}>
          <div className={styles.eyebrow}>Watch it work</div>
          <ul className={styles.list}>
            {systems.map((s) => (
              <li key={s.id}>
                <button className={styles.listRow} onClick={() => p.onPlay(s)}>
                  <span>
                    <b>
                      <i className={styles.flowDot} style={{ background: FLOW_COLORS[s.kind] }} />
                      {s.name}
                    </b>
                    <small>{FLOW_WORDS[s.kind].verb}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasExpert &&
        (p.expert ? (
          <div className={styles.block}>
            <div className={styles.eyebrow}>Expert details</div>
            {part.engineering && <p className={styles.body}>{part.engineering}</p>}
            {part.specs.length > 0 && (
              <dl className={styles.specs}>
                {part.specs.map((s) => (
                  <div key={s.label}>
                    <dt>{s.label}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {part.failureModes.length > 0 && (
              <>
                <div className={styles.subhead}>What can go wrong</div>
                <ul className={styles.bullets}>
                  {part.failureModes.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <button className={styles.textBtn} onClick={p.onExpert}>
            Show the science behind it <ArrowRight size={14} />
          </button>
        ))}

      <div className={styles.block}>
        <div className={styles.eyebrow}>My notes</div>
        <textarea className={styles.notes} rows={3} value={p.note} onChange={(e) => p.onNote(e.target.value)} placeholder="Write something to remember…" aria-label="My notes about this part" />
      </div>

      {p.nextId && (
        <button className={styles.nextRow} onClick={() => p.onSelect(p.nextId)}>
          <span className={styles.eyebrow}>Next part</span>
          <span className={styles.nextName}>
            {byId.get(p.nextId)?.name} <ArrowRight size={18} />
          </span>
        </button>
      )}
    </div>
  );
}
