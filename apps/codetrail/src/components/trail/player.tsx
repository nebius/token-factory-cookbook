"use client";

import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, CornerUpRight, Download, FileText, Link2, MessageSquareText, Pause, PenLine, Play, Share2, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Rich } from "@/components/rich";
import { tourToSequence } from "@/lib/export-map";
import { copyText } from "@/lib/announce";
import { useMenu } from "@/lib/use-menu";
import { groupsOf } from "@/lib/architecture";
import { SUPPORT } from "@/lib/palette";
import { onCode, type Atlas, type Tour } from "@/lib/schemas";
import { CallLine } from "./cost";

export const sameText = (a: string, b: string) => a.trim().toLowerCase().replace(/[?.!\s]+$/, "") === b.trim().toLowerCase().replace(/[?.!\s]+$/, "");

type Props = {
  tour: Tour;
  atlas: Atlas;
  step: number;
  playing: boolean;
  speed: number;
  fromCache: boolean;
  onStep: (i: number) => void;
  onToggle: () => void;
  onSpeed: () => void;
  onShare: () => void;
  onExport: () => void;
  onTranscript: () => void;
  onReceipt: () => void;
  /** Starts editing a copy of this tour. */
  onEdit?: () => void;
  /** Copies the tour, with the architecture, as a prompt for an AI chat. */
  onPrompt?: () => void;
  /** The tour to go on to from the last step. */
  next?: { title: string; meta: string; run: () => void } | null;
  /** The tour before this one in the repo's series, offered on the first step. */
  prev?: { title: string; run: () => void } | null;
  /** Steps already seen (in this browser). */
  seen?: number[];
};

export function Narration({ tour, atlas, step, fromCache, onShare, onExport, onTranscript, onReceipt, onEdit, onPrompt, next, prev }: Pick<Props, "tour" | "atlas" | "step" | "fromCache" | "onShare" | "onExport" | "onTranscript" | "onReceipt" | "onEdit" | "onPrompt" | "next" | "prev">) {
  const s = tour.steps[step];
  const node = atlas.nodes.find((n) => n.id === s.node);
  const colorOf = useMemo(() => groupsOf(atlas.nodes).color, [atlas.nodes]);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 font-mono text-[11.5px] text-fg-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 whitespace-nowrap text-trail">
            {String(step + 1).padStart(2, "0")} / {String(tour.steps.length).padStart(2, "0")}
          </span>
          {node && (
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              · <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorOf.get(node.id) ?? SUPPORT }} />
              <span className="truncate">{node.label}</span>
            </span>
          )}
        </span>
        {s.stale ? (
          <span className="inline-flex shrink-0 items-center gap-1 tracking-[0.1em] text-warn uppercase" title="This step was written for an earlier commit, and the line it quoted isn't in this version of the file. It's shown where it was.">
            <AlertTriangle className="size-3" /> code changed
          </span>
        ) : onCode(s) && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 tracking-[0.1em] uppercase ${s.corrected ? "text-warn" : "text-ok"}`}
            title={s.corrected ? "The model's line numbers were off; Codetrail moved the range to the line it quoted." : "The line the model quoted is inside this range in the real file."}
          >
            {s.corrected ? <CornerUpRight className="size-3" /> : <Check className="size-3" />}
            {s.corrected ? "range corrected" : "lines checked"}
          </span>
        )}
      </div>
      <h2 className="mt-2.5 font-display text-[24px] leading-[1.08] font-medium tracking-[-0.03em] [font-stretch:82%] sm:text-[26px]">
        <Rich text={s.title} />
      </h2>
      <div className="mt-2 text-[14.5px] leading-relaxed text-fg-2">
        <Rich text={s.narration} blocks />
      </div>
      {s.stale && <p className="mt-2 rounded-[10px] border border-warn/40 px-3 py-2 text-[12.5px] text-fg-2">This step's code changed since the tour was written{tour.carriedFrom ? ` (at ${tour.carriedFrom.sha.slice(0, 7)})` : ""}: the line it pointed at is gone, so it's shown where it was.</p>}
      {step === 0 && (
        <div className="mt-3 border-t border-line pt-3">
          {tour.carriedFrom && (
            <p className="mb-2 font-mono text-[11px] text-fg-3">
              Brought over from the read at {tour.carriedFrom.sha.slice(0, 7)} · {tour.carriedFrom.moved} {tour.carriedFrom.moved === 1 ? "step" : "steps"} moved with the code
              {tour.carriedFrom.stale ? <span className="text-warn"> · {tour.carriedFrom.stale} changed</span> : ""}
            </p>
          )}
          {prev && (
            <button onClick={prev.run} className="mb-2 block max-w-full truncate text-left font-mono text-[11px] text-trail hover:underline">
              ← Previous tour: {prev.title}
            </button>
          )}
          {tour.summary && (
            <p className="mb-2 text-[13.5px] leading-relaxed text-fg-2">
              <span className="font-mono text-[10.5px] tracking-[0.15em] text-fg-3 uppercase">In short · </span>
              <Rich text={tour.summary} />
            </p>
          )}
          <div>
            {tour.source === "custom" ? (
              <span className="font-mono text-[11px] text-fg-3">Written here · every step checked against the code · free</span>
            ) : fromCache ? (
              <span className="font-mono text-[11px] text-fg-3">Saved earlier · free to replay</span>
            ) : tour.calls[0]?.kind === "atlas" ? (
              <span className="font-mono text-[11px] text-fg-3">
                Written in the same call as the map ·{" "}
                <button onClick={onReceipt} className="text-trail hover:underline">
                  see the receipt
                </button>
              </span>
            ) : (
              tour.calls[0] && <CallLine call={tour.calls[0]} />
            )}
          </div>
        </div>
      )}
      {next && step === tour.steps.length - 1 && (
        <button onClick={next.run} className="mt-3 flex w-full items-center justify-between gap-3 rounded-[12px] border border-trail/50 bg-trail-soft px-3.5 py-2.5 text-left hover:border-trail">
          <span className="min-w-0">
            <span className="block font-mono text-[10.5px] tracking-[0.14em] text-trail uppercase">Next tour</span>
            <span className="block truncate text-[14px] text-fg">
              <Rich text={next.title} />
            </span>
          </span>
          <span className="shrink-0 font-mono text-[11px] text-fg-3">{next.meta} →</span>
        </button>
      )}
      <ShareMenu tour={tour} atlas={atlas} onShare={onShare} onExport={onExport} onTranscript={onTranscript} onEdit={onEdit} onPrompt={onPrompt} />
    </div>
  );
}

/** One "Share & export" menu instead of a row of buttons, so the player keeps its room on small screens. */
function ShareMenu({ tour, atlas, onShare, onExport, onTranscript, onEdit, onPrompt }: Pick<Props, "tour" | "atlas" | "onShare" | "onExport" | "onTranscript" | "onEdit" | "onPrompt">) {
  const m = useMenu();
  const [copied, setCopied] = useState<"link" | "sequence" | null>(null);
  const copy = (what: "link" | "sequence", text: string) =>
    copyText(text, what === "link" ? "Link to this step copied" : "Sequence diagram copied as Mermaid").then((ok) => {
      if (!ok) return;
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  return (
    <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
      <SmallButton
        onClick={() => copy("link", window.location.href)}
        label={copied === "link" ? "Copied" : "Link to this step"}
        icon={copied === "link" ? <Check className="size-3 text-ok" /> : <Link2 className="size-3" />}
      />
      <button
        ref={m.trigger}
        onClick={() => m.setOpen((o) => !o)}
        onKeyDown={m.onTriggerKey}
        aria-expanded={m.open}
        aria-haspopup="menu"
        aria-controls="share-menu"
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 font-mono text-[10.5px] tracking-[0.06em] text-fg-3 hover:border-outline hover:text-fg"
      >
        <ChevronDown className="size-3" aria-hidden />
        {copied === "sequence" ? "Mermaid copied" : "Share & export"}
      </button>
      {m.open && (
        <ul
          id="share-menu"
          ref={m.menu}
          role="menu"
          aria-label="Share & export"
          onKeyDown={m.onMenuKey}
          className="absolute top-full left-0 z-20 mt-1 w-64 rounded-[10px] border border-line bg-panel p-1 shadow-lg"
        >
          {[
            { label: "Read as text · T", icon: <FileText className="size-3.5" />, run: onTranscript },
            { label: "Share card (link preview image)", icon: <Share2 className="size-3.5" />, run: onShare },
            {
              label: "Copy as Mermaid sequence diagram",
              icon: <Workflow className="size-3.5" />,
              run: () => void copy("sequence", tourToSequence(tour, atlas)),
            },
            ...(onPrompt
              ? [
                  {
                    label: "Copy as a prompt for an AI chat",
                    icon: <MessageSquareText className="size-3.5" />,
                    run: onPrompt,
                  },
                ]
              : []),
            { label: "Export for VS Code CodeTour", icon: <Download className="size-3.5" />, run: onExport },
            ...(onEdit ? [{ label: "Edit a copy of this tour", icon: <PenLine className="size-3.5" />, run: onEdit }] : []),
          ].map((item) => (
            <li key={item.label} role="none">
              <button
                role="menuitem"
                tabIndex={-1}
                onClick={m.pick(item.run)}
                className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12.5px] text-fg-2 hover:bg-raised hover:text-fg focus:bg-raised focus:text-fg"
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SmallButton({ onClick, label, icon }: { onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 font-mono text-[10.5px] tracking-[0.06em] text-fg-3 hover:border-outline hover:text-fg"
    >
      {icon}
      {label}
    </button>
  );
}

export function PlayerBar({
  tour,
  step,
  playing,
  speed,
  dwellMs,
  onStep,
  onToggle,
  onSpeed,
  seen = [],
}: Omit<Props, "atlas" | "fromCache" | "onShare" | "onExport" | "onTranscript" | "onReceipt" | "next" | "prev"> & { dwellMs: number }) {
  const last = tour.steps.length - 1;
  // A countdown to the next step while the tour plays, so autoplay is visibly doing something.
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!playing || step >= last) return;
    const end = Date.now() + dwellMs;
    setLeft(Math.ceil(dwellMs / 1000));
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [playing, step, dwellMs, last]);
  const status = playing ? (step >= last ? "Last step" : `Next step in ${left}s`) : step >= last ? "Replay tour" : "Play tour";
  return (
    <div className="flex items-center gap-2.5">
      <button
        onClick={() => onStep(Math.max(0, step - 1))}
        disabled={step === 0}
        aria-label={step > 0 ? `Previous step: ${tour.steps[step - 1].title} (←)` : "Previous step (←)"}
        title={step > 0 ? `Previous: ${tour.steps[step - 1].title} (←)` : "Previous step (←)"}
        className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line text-fg-2 hover:border-outline hover:text-fg disabled:opacity-30"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        onClick={onToggle}
        aria-label={playing ? "Pause the tour (space)" : "Play the tour: steps advance on their own (space)"}
        title={playing ? "Pause the tour (space)" : "Play the tour: steps advance on their own (space)"}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-trail text-[#16171a] transition hover:bg-trail-strong"
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
      </button>
      <button
        onClick={() => onStep(Math.min(last, step + 1))}
        disabled={step === last}
        aria-label={step < last ? `Next step: ${tour.steps[step + 1].title} (→)` : "Next step (→)"}
        title={step < last ? `Next: ${tour.steps[step + 1].title} (→)` : "Next step (→)"}
        className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line text-fg-2 hover:border-outline hover:text-fg disabled:opacity-30"
      >
        <ChevronRight className="size-4" />
      </button>
      <span className="hidden w-[118px] shrink-0 font-mono text-[11px] whitespace-nowrap text-fg-3 sm:inline">{status}</span>
      {/* Each step is a 24px target at least; with many steps the row scrolls. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {tour.steps.map((s, i) => (
          <button
            key={i}
            onClick={() => onStep(i)}
            title={`${i + 1}. ${s.title}${seen.includes(i) ? " (seen)" : ""}`}
            aria-label={`Step ${i + 1}: ${s.title}${seen.includes(i) ? ", seen" : ""}`}
            aria-current={i === step ? "step" : undefined}
            className="group flex h-7 min-w-6 flex-1 items-center"
          >
            {i === step && playing && step < last ? (
              // The current step fills up while it waits, then the tour moves on.
              <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-trail/30">
                <span key={step} className="step-fill-bar absolute inset-y-0 left-0 rounded-full bg-trail" style={{ animationDuration: `${dwellMs}ms` }} />
              </span>
            ) : (
              <span className={`h-1 w-full rounded-full transition ${i === step ? "h-1.5 bg-trail" : i < step || seen.includes(i) ? "bg-trail/45" : "bg-line group-hover:bg-outline"}`} />
            )}
          </button>
        ))}
      </div>
      <button onClick={onSpeed} className="min-h-6 shrink-0 rounded-md px-2 py-1 font-mono text-[11px] text-fg-3 hover:text-fg" title="Playback speed: click to change">
        {speed}× speed
      </button>
    </div>
  );
}
