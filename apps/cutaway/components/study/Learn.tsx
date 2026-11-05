"use client";

import { ArrowRight, Check, RotateCcw, Search, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { celebrate } from "@/components/ui/celebrate";
import type { Progress } from "@/lib/db/user";
import type { Meta } from "@/lib/schema/teardown";
import styles from "./study.module.css";

type Props = {
  meta: Meta;
  expert: boolean;
  progress: Progress;
  notes: Record<string, string>;
  onAnswer: (i: number, choice: number) => void;
  onResetQuiz: () => void;
  onNote: (partId: string, body: string) => void;
  onSeePart: (id: string) => void;
  onExpert: () => void;
};


export function Learn(p: Props) {
  const { study } = p.meta;
  const [q, setQ] = useState("");
  const byId = new Map(p.meta.parts.map((x) => [x.id, x.name]));
  const words = study.glossary.filter((g) => !q || `${g.term} ${g.definition}`.toLowerCase().includes(q.toLowerCase()));
  const partNotes = Object.entries(p.notes).filter(([k, v]) => k && v.trim() && byId.has(k));

  return (
    <div className={`${styles.learn} scroll`}>
      <div className={styles.learnInner}>
        {study.quiz.length > 0 && <Quiz {...p} />}

        {study.keyConcepts.length > 0 && (
          <section>
            <h2 className={styles.h2}> Things to remember
            </h2>
            <div className={styles.concepts}>
              {study.keyConcepts.map((c, i) => (
                <div key={c.title} className={styles.concept}>
                  <span className={styles.conceptNum}>{String(i + 1).padStart(2, "0")}</span>
                  <b>{c.title}</b>
                  <p>{c.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {study.principles.length > 0 && (
          <section>
            <h2 className={styles.h2}> The science
            </h2>
            {p.expert ? (
              <div className={styles.concepts}>
                {study.principles.map((pr) => (
                  <div key={pr.title} className={styles.concept}>
                    <b>{pr.title}</b>
                    <p className="mono" style={{ fontSize: 13 }}>
                      {pr.body}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <button className={styles.expertTeaser} onClick={p.onExpert}>
                {study.principles.length} ideas with real numbers and equations. Turn on Expert details to see them <ArrowRight size={14} />
              </button>
            )}
          </section>
        )}

        {study.glossary.length > 0 && (
          <section>
            <div className={styles.sectionRow}>
              <h2 className={styles.h2}> Word bank
              </h2>
              <div className={styles.search} style={{ width: 240, margin: 0 }}>
                <Search size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a word" aria-label="Find a word" />
              </div>
            </div>
            <dl className={styles.words}>
              {words.map((g) => (
                <div key={g.term}>
                  <dt>{g.term}</dt>
                  <dd>{g.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section>
          <h2 className={styles.h2}> My notes
          </h2>
          <textarea className={styles.notes} rows={5} value={p.notes[""] ?? ""} onChange={(e) => p.onNote("", e.target.value)} placeholder="What did you learn about this machine?" aria-label="My notes about this machine" />
          {partNotes.length > 0 && (
            <div className={styles.partNotes}>
              {partNotes.map(([id, body]) => (
                <button key={id} className={styles.partNote} onClick={() => p.onSeePart(id)}>
                  <b>{byId.get(id)}</b>
                  <span>{body}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** One question at a time, with instant feedback, confetti for right answers and a score at the end. */
function Quiz({ meta, progress, onAnswer, onResetQuiz, onSeePart }: Props) {
  const quiz = meta.study.quiz;
  const firstOpen = quiz.findIndex((_, i) => progress.quiz[i] === undefined);
  const [i, setI] = useState(firstOpen === -1 ? quiz.length : firstOpen);
  const byId = new Map(meta.parts.map((x) => [x.id, x.name]));
  const right = Object.entries(progress.quiz).filter(([k, a]) => quiz[Number(k)]?.answer === a).length;
  const finished = i >= quiz.length;

  useEffect(() => {
    if (finished && right === quiz.length && quiz.length > 0) void celebrate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const pick = (choice: number) => {
    if (progress.quiz[i] !== undefined) return;
    onAnswer(i, choice);
    if (choice === quiz[i].answer) void celebrate();
  };

  return (
    <section className={styles.quiz}>
      <div className={styles.quizHead}>
        <h2 className={styles.h2} style={{ margin: 0 }}> Quiz
        </h2>
        <div className={styles.quizDots}>
          {quiz.map((item, k) => {
            const a = progress.quiz[k];
            return (
              <button key={k} data-on={k === i} data-state={a === undefined ? "" : a === item.answer ? "right" : "wrong"} onClick={() => setI(k)} aria-label={`Question ${k + 1}`} />
            );
          })}
        </div>
      </div>

      {finished ? (
          <motion.div key="done" className={styles.quizDone} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
            <div className={styles.stars}>
              {quiz.map((item, k) => (
                <span key={k} data-on={progress.quiz[k] === item.answer}>
                  ★
                </span>
              ))}
            </div>
            <h3>
              You got {right} out of {quiz.length}!
            </h3>
            <p>{right === quiz.length ? "Perfect score. You really know how this machine works!" : right >= quiz.length / 2 ? "Great job! Look at the ones you missed and try again." : "Good try! Explore the parts some more, then have another go."}</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                onResetQuiz();
                setI(0);
              }}
            >
              <RotateCcw size={16} /> Try again
            </button>
          </motion.div>
        ) : (
          <motion.div key={i} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
            <div className={styles.eyebrow}>
              Question {i + 1} of {quiz.length}
            </div>
            <h3 className={styles.question}>{quiz[i].question}</h3>
            <div className={styles.options}>
              {quiz[i].options.map((o, j) => {
                const picked = progress.quiz[i];
                const state = picked === undefined ? "" : j === quiz[i].answer ? "right" : j === picked ? "wrong" : "dim";
                return (
                  <motion.button key={j} className={styles.option} data-state={state} onClick={() => pick(j)} whileTap={{ scale: 0.98 }} disabled={picked !== undefined}>
                    <span className={styles.optKey}>{state === "right" ? <Check size={16} strokeWidth={3} /> : state === "wrong" ? <X size={16} strokeWidth={3} /> : String.fromCharCode(65 + j)}</span>
                    {o}
                  </motion.button>
                );
              })}
            </div>
            {progress.quiz[i] !== undefined && (
              <motion.div className={styles.explain} data-right={progress.quiz[i] === quiz[i].answer} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <b>{progress.quiz[i] === quiz[i].answer ? "Yes, that's right! " : "Not quite. "}</b>
                {quiz[i].explanation}
                <div className={styles.explainRow}>
                  {quiz[i].partIds.slice(0, 2).map((id) => (
                    <button key={id} className="btn btn-sm" onClick={() => onSeePart(id)}>
                      See the {byId.get(id) ?? id}
                    </button>
                  ))}
                  <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setI((k) => k + 1)}>
                    {i === quiz.length - 1 ? "See my score" : "Next question"} <ArrowRight size={15} />
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
    </section>
  );
}
