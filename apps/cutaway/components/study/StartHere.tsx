"use client";

import { ArrowRight } from "lucide-react";
import { ReadAloud } from "@/components/ui/ReadAloud";
import type { Progress } from "@/lib/db/user";
import type { FlowSystem, Meta } from "@/lib/schema/teardown";
import { FLOW_COLORS } from "@/lib/viewer/engine";
import { FLOW_WORDS } from "@/lib/ui/words";
import type { TeardownInfo } from "./StudyView";
import styles from "./study.module.css";

type Props = {
  teardown: TeardownInfo;
  meta: Meta;
  progress: Progress;
  expert: boolean;
  onApart: () => void;
  onSteps: () => void;
  onQuiz: () => void;
  onPlay: (s: FlowSystem) => void;
  onFirstPart: () => void;
};

export function StartHere(p: Props) {
  const { meta, progress } = p;
  const found = progress.partsOpened.filter((id) => meta.parts.some((x) => x.id === id)).length;
  const right = Object.entries(progress.quiz).filter(([i, a]) => meta.study.quiz[Number(i)]?.answer === a).length;
  const [x, y, z] = meta.device.sizeMm;
  const ways = [
    { title: "Take it apart", text: "Pull every piece away to see inside", on: p.onApart, show: true },
    { title: "Step by step", text: `${meta.steps.length} steps, from the outside in`, on: p.onSteps, show: meta.steps.length > 0 },
    { title: "Quiz yourself", text: `${meta.study.quiz.length} questions`, on: p.onQuiz, show: meta.study.quiz.length > 0 },
  ];
  return (
    <div className={`${styles.panel} scroll`}>
      {p.teardown.hasPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.photo} src={`/api/input/${p.teardown.id}`} alt="The photo this machine was made from" />
      )}
      <div className={styles.eyebrow}>Start here</div>
      <h2 className={styles.panelTitle}>How it works</h2>
      <p className={styles.body}>{meta.study.overview}</p>
      <div>
        <ReadAloud text={meta.study.overview} />
      </div>

      <div className={styles.block}>
        <div className={styles.eyebrow}>Ways in</div>
        <ul className={styles.list}>
          {ways
            .filter((w) => w.show)
            .map((w) => (
              <li key={w.title}>
                <button className={styles.listRow} onClick={w.on}>
                  <span>
                    <b>{w.title}</b>
                    <small>{w.text}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              </li>
            ))}
        </ul>
      </div>

      <div className={styles.block}>
        <div className={styles.eyebrow}>Your progress</div>
        <div className={styles.scores}>
          <button onClick={p.onFirstPart}>
            <b>
              {found}
              <small>/{meta.parts.length}</small>
            </b>
            <span>parts found</span>
          </button>
          <div>
            <b>
              {progress.stepsDone.length}
              <small>/{meta.steps.length}</small>
            </b>
            <span>steps</span>
          </div>
          <div>
            <b>
              {right}
              <small>/{meta.study.quiz.length}</small>
            </b>
            <span>quiz</span>
          </div>
        </div>
      </div>

      {meta.systems.length > 0 && (
        <div className={styles.block}>
          <div className={styles.eyebrow}>Watch it work</div>
          <ul className={styles.list}>
            {meta.systems.map((s) => (
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

      {p.expert && (
        <div className={styles.block}>
          <div className={styles.eyebrow}>Size</div>
          <p className={styles.body}>
            {x} × {y} × {z} mm · {meta.parts.length} parts
          </p>
        </div>
      )}
      <p className={styles.fine}>{meta.device.disclaimer}</p>
    </div>
  );
}
