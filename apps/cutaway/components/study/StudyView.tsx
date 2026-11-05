"use client";

import { Box, Footprints, GraduationCap, PencilRuler } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Viewer3D, type BuildResult } from "@/components/viewer/Viewer3D";
import { celebrate } from "@/components/ui/celebrate";
import { useStudySaver } from "@/lib/client/useSaver";
import type { Progress } from "@/lib/db/user";
import type { Diagram, FlowSystem, Meta, ViewName } from "@/lib/schema/teardown";
import type { TeardownEngine } from "@/lib/viewer/engine";
import { THUMBNAIL, THUMBNAIL_SIZE } from "@/lib/viewer/frame";
import { Drawings } from "./Drawings";
import { FlowBar } from "./FlowBar";
import { Learn } from "./Learn";
import { PartCard } from "./PartCard";
import { PartsPanel } from "./PartsPanel";
import { StartHere } from "./StartHere";
import { StepPlayer } from "./StepPlayer";
import { StillWorking } from "./StillWorking";
import { TopBar } from "./TopBar";
import { startTour } from "./tour";
import styles from "./study.module.css";

export type TeardownInfo = {
  id: number;
  slug: string;
  version: number;
  provider: string | null;
  model: string | null;
  createdAt: string;
  hasPhoto: boolean;
  hasThumb: boolean;
};

type Props = {
  teardown: TeardownInfo;
  meta: Meta;
  parts: { id: string; code: string }[];
  diagrams: Diagram[];
  versions: { id: number; version: number; created_at: string; provider: string | null }[];
  notes: Record<string, string>;
  progress: Progress;
  bookmarked: boolean;
  fromLibrary: boolean;
  /** Kimi is still drawing diagrams and checking its work. */
  working?: boolean;
};

export type Tab = "explore" | "steps" | "drawings" | "learn";

const TABS: { id: Tab; label: string; icon: typeof Box; key: string; tip: string }[] = [
  { id: "explore", label: "Explore", icon: Box, key: "1", tip: "Spin it, take it apart and tap parts" },
  { id: "steps", label: "Step by step", icon: Footprints, key: "2", tip: "Take it apart one step at a time" },
  { id: "drawings", label: "Diagrams", icon: PencilRuler, key: "3", tip: "Flat drawings with every part named" },
  { id: "learn", label: "Learn & quiz", icon: GraduationCap, key: "4", tip: "The big ideas, a quiz and a word bank" },
];

export function StudyView(props: Props) {
  const { meta, teardown } = props;
  const [tab, setTab] = useState<Tab>("explore");
  const [expert, setExpert] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [isolate, setIsolate] = useState<string | null>(null);
  // Parts the learner hid from the list to see behind them (Explore only; steps manage their own).
  const [userHidden, setUserHidden] = useState<string[]>([]);
  const hideParts = (ids: string[], hide: boolean) => setUserHidden((h) => (hide ? [...new Set([...h, ...ids])] : h.filter((x) => !ids.includes(x))));
  const [system, setSystem] = useState<FlowSystem | null>(null);
  const [step, setStep] = useState(0);
  const [view, setView] = useState<{ name: ViewName; ids?: string[]; nonce: number } | null>(null);
  const [explodeRequest, setExplodeRequest] = useState<{ value: number; nonce: number } | null>(null);
  const [results, setResults] = useState<Record<string, BuildResult>>({});
  const [notes, setNotes] = useState(props.notes);
  const [progress, setProgress] = useState(props.progress);
  const [bookmarked, setBookmarked] = useState(props.bookmarked);
  const [sheet, setSheet] = useState<"parts" | "info" | null>(null);
  const engine = useRef<TeardownEngine | null>(null);
  const saver = useStudySaver(teardown.slug);

  useEffect(() => {
    try {
      setExpert(localStorage.getItem("cutaway-expert") === "1");
    } catch {
      /* ignore */
    }
  }, []);
  const changeExpert = (on: boolean) => {
    setExpert(on);
    try {
      localStorage.setItem("cutaway-expert", on ? "1" : "0");
    } catch {
      /* ignore */
    }
    // With no part picked the change is easy to miss, so say where the extra detail went.
    if (on) toast(selected ? "Expert details on: specs, equations and failure modes are below." : "Expert details on. Pick any part to see its specs and how it fails, or open Learn & quiz for the science.");
  };

  const byId = useMemo(() => new Map(meta.parts.map((p) => [p.id, p])), [meta]);
  const found = progress.partsOpened.filter((id) => byId.has(id)).length;

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      if (!id) return;
      setSheet("info");
      if (!progress.partsOpened.includes(id)) {
        const next = [...progress.partsOpened, id];
        setProgress((p) => ({ ...p, partsOpened: next }));
        saver.save(`part:${id}`, { kind: "progress", partsOpened: [id] });
        if (next.filter((x) => byId.has(x)).length === meta.parts.length) {
          void celebrate(true);
          toast.success(`You found all ${meta.parts.length} parts! 🎉`);
        }
      }
    },
    [progress.partsOpened, saver, byId, meta.parts.length],
  );
  const zoomTo = (id: string) => setView({ name: "iso", ids: [id], nonce: Date.now() });

  // Steps: parts removed so far stay hidden; the current step's parts are highlighted.
  const stepState = useMemo(() => {
    if (tab !== "steps" || !meta.steps.length) return { hidden: [] as string[], focus: [] as string[] };
    return { hidden: meta.steps.slice(0, step + 1).flatMap((s) => s.removePartIds), focus: meta.steps[step]?.focusPartIds ?? [] };
  }, [tab, step, meta.steps]);

  useEffect(() => {
    if (tab !== "steps") return;
    const s = meta.steps[step];
    if (!s) return;
    setSystem(null);
    setView({ name: s.view, ids: s.focusPartIds.length ? s.focusPartIds : undefined, nonce: Date.now() });
    if (!progress.stepsDone.includes(step)) {
      setProgress((p) => ({ ...p, stepsDone: [...p.stepsDone, step].sort((a, b) => a - b) }));
      saver.save(`step:${step}`, { kind: "progress", stepsDone: [step] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, step]);

  useEffect(() => {
    setHovered(null);
    if (tab === "explore") setView({ name: "iso", nonce: Date.now() });
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=slider]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const tabKey = TABS.find((x) => x.key === e.key);
      if (tabKey) return setTab(tabKey.id);
      if (e.key === "Escape") {
        setSelected(null);
        setIsolate(null);
        setSystem(null);
      }
      if (tab === "steps" && e.key === "ArrowRight") setStep((s) => Math.min(meta.steps.length - 1, s + 1));
      if (tab === "steps" && e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, meta.steps.length]);

  // After the first build: save a library thumbnail if missing (a local render), then offer the tour once.
  const firstBuild = useRef(true);
  const onBuildDone = useCallback(
    (all: BuildResult[]) => {
      setResults((r) => ({ ...r, ...Object.fromEntries(all.map((x) => [x.id, x])) }));
      if (!firstBuild.current) return;
      firstBuild.current = false;
      setTimeout(() => {
        if (!teardown.hasThumb && engine.current) {
          const [img] = engine.current.snapshot([THUMBNAIL], THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height, THUMBNAIL_SIZE.background);
          if (img) void fetch(`/api/teardowns/${teardown.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "thumbnail", thumbnail: img }) });
        }
        try {
          if (!localStorage.getItem("cutaway-tour-done") && window.innerWidth > 900) {
            localStorage.setItem("cutaway-tour-done", "1");
            startTour();
          }
        } catch {
          /* ignore */
        }
      }, 600);
    },
    [teardown.id, teardown.hasThumb],
  );

  const saveNote = (partId: string, body: string) => {
    setNotes((n) => ({ ...n, [partId]: body }));
    saver.save(`note:${partId}`, { kind: "note", partId, body });
  };
  const answerQuiz = (i: number, choice: number) => {
    setProgress((p) => ({ ...p, quiz: { ...p.quiz, [i]: choice } }));
    saver.save(`quiz:${i}`, { kind: "progress", quiz: { [i]: choice } }, true);
  };
  const resetQuiz = () => {
    setProgress((p) => ({ ...p, quiz: {} }));
    saver.save("reset-quiz", { kind: "progress", resetQuiz: true }, true);
  };
  const toggleBookmark = () => {
    const on = !bookmarked;
    setBookmarked(on);
    saver.save("bookmark", { kind: "bookmark", on }, true);
    toast.success(on ? "Saved! Find it under “Saved”." : "Removed from Saved.");
  };
  const playSystem = (s: FlowSystem | null) => {
    setSystem(s);
    if (s) {
      setTab("explore");
      setView({ name: "iso", nonce: Date.now() });
    }
  };

  const showViewer = tab === "explore" || tab === "steps";
  const selectedPart = selected ? (byId.get(selected) ?? null) : null;
  const order = meta.parts.map((p) => p.id);
  const idx = selected ? order.indexOf(selected) : -1;

  return (
    <div className={styles.app}>
      {props.working && <StillWorking id={props.teardown.id} />}
      <TopBar
        teardown={teardown}
        meta={meta}
        versions={props.versions}
        expert={expert}
        onExpert={changeExpert}
        bookmarked={bookmarked}
        onBookmark={toggleBookmark}
        fromLibrary={props.fromLibrary}
        diagrams={props.diagrams}
        engine={engine}
      />
      <div className={styles.grid}>
        <aside className={styles.left} data-open={sheet === "parts"} data-tour="parts">
          <PartsPanel
            meta={meta}
            selected={selected}
            hovered={hovered}
            opened={progress.partsOpened}
            results={results}
            hidden={userHidden}
            onHide={hideParts}
            onSelect={(id) => {
              select(id);
              if (id) zoomTo(id);
            }}
            onHover={setHovered}
          />
        </aside>

        <section className={styles.center}>
          <div className={styles.modes} data-tour="modes">
            <div className={styles.modeTabs} role="tablist">
              {TABS.map(({ id, label, tip, icon: Icon, key }) => (
                <button key={id} role="tab" aria-selected={tab === id} className={styles.mode} onClick={() => setTab(id)} title={`${tip} (${key})`}>
                  <Icon size={17} aria-hidden="true" />
                  {label}
                  <span className={styles.modeKey}>{key}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.stage}>
            <div className={styles.viewerSlot} data-hidden={!showViewer}>
              <Viewer3D
                meta={meta}
                parts={props.parts}
                selected={selected}
                hovered={hovered}
                onSelect={select}
                onHover={setHovered}
                isolate={isolate}
                system={system}
                hidden={tab === "steps" ? stepState.hidden : userHidden}
                focus={stepState.focus}
                view={view}
                explodeRequest={explodeRequest}
                keyboard={showViewer}
                active={showViewer}
                toolbar={tab === "explore"}
                hint
                initialExplode={0.3}
                initialLabels="off"
                onBuildDone={onBuildDone}
                onEngine={(e) => (engine.current = e)}
              >
                {tab === "explore" && meta.systems.length > 0 && <FlowBar systems={meta.systems} active={system} onPlay={playSystem} parts={byId} onSelect={select} />}
                {isolate && tab === "explore" && (
                  <button className={styles.isoChip} onClick={() => setIsolate(null)}>
                    Showing only {byId.get(isolate)?.name} · Show everything ✕
                  </button>
                )}
                {tab === "steps" && <StepPlayer meta={meta} step={step} onStep={setStep} done={progress.stepsDone} onSelect={select} />}
              </Viewer3D>
            </div>
            {tab === "drawings" && <Drawings diagrams={props.diagrams} meta={meta} selected={selected} hovered={hovered} onSelect={select} onHover={setHovered} />}
            {tab === "learn" && (
              <Learn
                meta={meta}
                expert={expert}
                progress={progress}
                notes={notes}
                onAnswer={answerQuiz}
                onResetQuiz={resetQuiz}
                onNote={saveNote}
                onSeePart={(id) => {
                  select(id);
                  setTab("explore");
                  zoomTo(id);
                }}
                onExpert={() => changeExpert(true)}
              />
            )}
          </div>
        </section>

        <aside className={styles.right} data-open={sheet === "info"} data-tour="info">
          {selectedPart ? (
            <PartCard
              key={selectedPart.id}
              part={selectedPart}
              meta={meta}
              expert={expert}
              result={results[selectedPart.id]}
              colors={results}
              note={notes[selectedPart.id] ?? ""}
              onNote={(b) => saveNote(selectedPart.id, b)}
              onSelect={(id) => {
                select(id);
                if (id) zoomTo(id);
              }}
              onClose={() => {
                setSelected(null);
                setSheet(null);
              }}
              isolated={isolate === selectedPart.id}
              onIsolate={() => setIsolate((x) => (x === selectedPart.id ? null : selectedPart.id))}
              onZoom={() => zoomTo(selectedPart.id)}
              onPlay={playSystem}
              prevId={idx > 0 ? order[idx - 1] : null}
              nextId={idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null}
              onExpert={() => changeExpert(true)}
            />
          ) : (
            <StartHere
              teardown={teardown}
              meta={meta}
              progress={progress}
              expert={expert}
              onApart={() => {
                setTab("explore");
                setExplodeRequest({ value: 1, nonce: Date.now() });
              }}
              onSteps={() => {
                setStep(0);
                setTab("steps");
              }}
              onQuiz={() => setTab("learn")}
              onPlay={playSystem}
              onFirstPart={() => select(meta.parts[0]?.id ?? null)}
            />
          )}
        </aside>
      </div>

      <nav className={styles.mobileBar}>
        <button className="btn btn-sm" onClick={() => setSheet((m) => (m === "parts" ? null : "parts"))}>
          Parts ({found}/{meta.parts.length})
        </button>
        <button className="btn btn-sm" onClick={() => setSheet((m) => (m === "info" ? null : "info"))}>
          {selectedPart ? selectedPart.name : "Start here"}
        </button>
      </nav>
    </div>
  );
}
