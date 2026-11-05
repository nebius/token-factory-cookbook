"use client";

import { ArrowLeft, ArrowRight, Check, Pause, Play } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ReadAloud } from "@/components/ui/ReadAloud";
import type { Meta } from "@/lib/schema/teardown";
import styles from "./study.module.css";

export function StepPlayer({ meta, step, onStep, done, onSelect }: { meta: Meta; step: number; onStep: (n: number) => void; done: number[]; onSelect: (id: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const s = meta.steps[step];
  const last = step >= meta.steps.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (last) return setPlaying(false);
    const t = setTimeout(() => onStep(step + 1), 5000);
    return () => clearTimeout(t);
  }, [playing, step, last, onStep]);

  if (!s) return <div className={styles.stepCard} data-inset="bottom">This machine has no step-by-step tour yet.</div>;
  const byId = new Map(meta.parts.map((p) => [p.id, p.name]));
  return (
    <div className={styles.stepCard} data-inset="bottom">
      <div className={styles.stepTop}>
        <div className={styles.stepDots}>
          {meta.steps.map((x, i) => (
            <button key={i} data-on={i === step} data-done={done.includes(i)} onClick={() => onStep(i)} aria-label={`Step ${i + 1}: ${x.title}`} title={x.title}>
              {done.includes(i) && i !== step ? <Check size={12} strokeWidth={3} /> : i + 1}
            </button>
          ))}
        </div>
        <ReadAloud text={`${s.title}. ${s.narration}`} compact />
      </div>
      {/* Keyed enter animation only: an exit-wait can stick when steps change quickly. */}
      <motion.div key={step} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
          <div className={styles.eyebrow}>
            Step {step + 1} of {meta.steps.length}
          </div>
          <h3 className={styles.stepTitle}>{s.title}</h3>
          <p className={styles.stepText}>{s.narration}</p>
          {s.focusPartIds.length > 0 && (
            <div className={styles.friends}>
              <span className="muted" style={{ fontWeight: 700, fontSize: 13 }}>
                Look at:
              </span>
              {s.focusPartIds.map((id) => (
                <button key={id} className="chip" onClick={() => onSelect(id)}>
                  {byId.get(id) ?? id}
                </button>
              ))}
            </div>
          )}
      </motion.div>
      <div className={styles.stepNav}>
        <button className="btn" onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0}>
          <ArrowLeft size={17} /> Back
        </button>
        <button className="btn" onClick={() => setPlaying((x) => !x)}>
          {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? "Pause" : "Play all"}
        </button>
        <button className="btn btn-primary" onClick={() => onStep(Math.min(meta.steps.length - 1, step + 1))} disabled={last}>
          {last ? "All done!" : "Next step"} <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}
