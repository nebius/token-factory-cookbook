"use client";

import { ArrowLeft, Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { AmountStep } from "./amount-step";
import { AssignStep } from "./assign-step";
import { CaptureStep } from "./capture-step";
import { emptyDraft, upgradeDraft, type Draft } from "./draft";
import { ReviewStep } from "./review-step";
import { SummaryStep } from "./summary-step";

export type WizardMode = { kind: "guest"; defaultCurrency: string };

export type StepId = "start" | "review" | "assign" | "amount" | "summary";

const FLOWS: Record<Draft["kind"], { id: StepId; label: string }[]> = {
  itemized: [
    { id: "start", label: "Start" },
    { id: "review", label: "Items" },
    { id: "assign", label: "Who had what" },
    { id: "summary", label: "Split" },
  ],
  amount: [
    { id: "start", label: "Start" },
    { id: "amount", label: "Details" },
    { id: "summary", label: "Split" },
  ],
};

const GUEST_KEY = "splitter-lite:split";

export function SplitWizard({ mode, scanEnabled }: { mode: WizardMode; scanEnabled: boolean }) {
  const initial = React.useCallback(() => emptyDraft(mode.defaultCurrency), [mode]);
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [step, setStep] = React.useState<StepId>("start");
  const [image, setImage] = React.useState<string[]>([]);
  const [restored, setRestored] = React.useState(false);

  // Drafts survive a refresh (in this browser only).
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(GUEST_KEY) ?? "null");
      if (saved?.draft) {
        setDraft(upgradeDraft(saved.draft, initial()));
        setStep(saved.step ?? "start");
      }
    } catch {
      // ignore unreadable drafts
    }
    setRestored(true);
  }, [initial]);

  React.useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(GUEST_KEY, JSON.stringify({ draft, step }));
    } catch {
      // Storage unavailable (private mode): the flow still works, it just won't survive a refresh.
    }
  }, [draft, step, restored]);

  const update = React.useCallback((patch: Partial<Draft> | ((d: Draft) => Draft)) => {
    setDraft((d) => (typeof patch === "function" ? patch(d) : { ...d, ...patch }));
  }, []);

  const reset = () => {
    setDraft(initial());
    setImage([]);
    setStep("start");
  };

  const flow = FLOWS[draft.kind];
  const index = Math.max(
    0,
    flow.findIndex((s) => s.id === step),
  );
  const go = (id: StepId) => {
    // Lines start shared by everyone, so people only tap the exceptions.
    if (id === "assign")
      update((d) =>
        d.people.length
          ? { ...d, assignments: Object.fromEntries(d.items.map((i) => [i.id, d.assignments[i.id]?.length ? d.assignments[i.id] : d.people.map((p) => p.id)])) }
          : d,
      );
    setStep(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => (index === 0 ? undefined : go(flow[index - 1].id));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-2 sm:px-6 sm:pt-4">
      <div className="mb-8 flex items-center gap-3">
        {index > 0 && (
          <button onClick={back} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-glass-border bg-glass-fill shadow-[inset_0_1px_0_var(--glass-shine)] backdrop-blur-md transition-colors hover:bg-muted" aria-label="Back">
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate text-muted-foreground">
            Quick split · reasoning on · calculator tools
          </p>
          <ol className="mt-2 flex items-center gap-1 rounded-pill border border-glass-border bg-glass-fill p-1 shadow-[inset_0_1px_0_var(--glass-shine),0_10px_30px_-14px_rgb(0_0_0/0.6)] backdrop-blur-xl" aria-label="Progress">
            {flow.map((s, i) => {
              const done = i < index;
              const current = i === index;
              return (
                <li
                  key={s.id}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex h-9 min-w-0 items-center justify-center gap-2 rounded-pill px-2.5 text-sm transition-all duration-300",
                    current
                      ? "flex-[2] border border-white/50 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--foreground)_97%,white),color-mix(in_srgb,var(--foreground)_80%,transparent))] font-medium text-background shadow-[inset_0_1px_0_rgb(255_255_255/0.8),0_6px_20px_-6px_color-mix(in_srgb,var(--foreground)_35%,transparent)] sm:flex-1"
                      : "flex-1",
                    done && "text-foreground",
                    !done && !current && "text-subtle",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular",
                      current ? "bg-background text-foreground" : done ? "bg-foreground text-background" : "border border-hairline",
                    )}
                  >
                    {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn("truncate", !current && "max-sm:hidden")}>{s.label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16 }}
        >
          {step === "start" && (
            <CaptureStep
              draft={draft}
              update={update}
              scanEnabled={scanEnabled}
              image={image}
              setImage={setImage}
              onItemized={() => {
                update({ kind: "itemized" });
                go("review");
              }}
              onAmount={() => {
                update({ kind: "amount" });
                go("amount");
              }}
              onContinue={() => go(draft.kind === "amount" ? "amount" : "review")}
            />
          )}
          {step === "review" && (
            <ReviewStep
              draft={draft}
              update={update}
              image={image}
              lockCurrency={false}
              onNext={() => go("assign")}
              scanEnabled={scanEnabled}
              onRemoveImage={() => {
                setImage([]);
              }}
              onReplace={() => {
                // Wrong bill: start over with a new one, keeping who's splitting and the currency.
                setImage([]);
                update((d) => ({ ...emptyDraft(d.currency, { people: d.people, paidBy: d.paidBy, category: d.category }) }));
                go("start");
              }}
            />
          )}
          {step === "assign" && (
            <AssignStep draft={draft} update={update} onNext={() => go("summary")} />
          )}
          {step === "amount" && (
            <AmountStep
              draft={draft}
              update={update}
              editablePeople
              lockCurrency={false}
              onNext={() => go("summary")}
            />
          )}
          {step === "summary" && (
            <SummaryStep draft={draft} update={update} onEdit={() => go(draft.kind === "amount" ? "amount" : "assign")} onReset={reset} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
