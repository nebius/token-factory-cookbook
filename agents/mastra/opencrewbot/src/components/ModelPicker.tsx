"use client";

import clsx from "clsx";
import { Check, RefreshCw, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { formatContext } from "@/lib/client/format";
import type { ModelOption } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { Drawer } from "./ui";

const price = (n: number | null) => (n === null ? "–" : `$${Number(n.toFixed(2))}`);

/** Three starting points, picked from whatever the live catalog has. */
const SUGGESTIONS: { tag: string; why: string; ids: string[] }[] = [
  { tag: "Fastest", why: "Quick replies for the lowest cost", ids: ["nvidia/Nemotron-3_5-Lightning", "deepseek-ai/DeepSeek-V4-Flash-0731"] },
  { tag: "Best all-rounder", why: "Good tool use, 1M context, low price", ids: ["MiniMaxAI/MiniMax-M3", "zai-org/GLM-5.3-Flash"] },
  { tag: "Strongest", why: "Hard research, planning and code", ids: ["Qwen/Qwen3.5-397B-A17B", "deepseek-ai/DeepSeek-V4-Pro", "zai-org/GLM-5.3"] },
];

function ModelDialog({ value, onPick, onClose }: { value: string; onPick: (id: string) => void; onClose: () => void }) {
  const { state, dispatch, toast } = useApp();
  const [query, setQuery] = useState("");
  const [toolsOnly, setToolsOnly] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const live = state.models.some((m) => m.live);

  const suggestions = useMemo(
    () =>
      SUGGESTIONS.map((s) => ({ ...s, model: s.ids.map((id) => state.models.find((m) => m.id === id)).find(Boolean) })).filter(
        (s): s is (typeof SUGGESTIONS)[number] & { model: ModelOption } => Boolean(s.model),
      ),
    [state.models],
  );

  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.models
      .filter((m) => (!toolsOnly || m.tools) && (!q || `${m.id} ${m.label} ${m.provider}`.toLowerCase().includes(q)))
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
  }, [state.models, query, toolsOnly]);

  // Keep the keyboard-highlighted row in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { models: fresh } = await api.models(true);
      dispatch({ type: "models", models: fresh });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't refresh models.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Drawer title="Choose a model" onClose={onClose}>
      <div className="sticky top-0 z-10 -mx-5 bg-side px-5 pt-1 pb-3">
        <div className="flex items-center gap-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-raised px-3.5 ring-1 ring-line focus-within:ring-2 focus-within:ring-accent">
            <Search size={15} className="shrink-0 text-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, models.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && models[active]) {
                  onPick(models[active].id);
                }
              }}
              placeholder="Search models"
              aria-label="Search models"
              className="min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-faint focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            title="Refresh from Nebius Token Factory"
            aria-label="Refresh model list"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-mute ring-1 ring-line hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={15} className={clsx(refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {!query && suggestions.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-[12.5px] font-medium text-mute">Suggested</h3>
          <div className="space-y-2">
            {suggestions.map(({ tag, why, model }) => {
              const selected = model.id === value;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onPick(model.id)}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1 transition-colors",
                    selected ? "bg-accent-soft ring-accent/50" : "bg-raised ring-line hover:bg-raised-2",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] font-medium text-[#8db4ff]">{tag}</span>
                    <span className="mt-0.5 block truncate text-[14.5px] font-medium text-ink">{model.label}</span>
                    <span className="mt-0.5 block text-[12.5px] text-mute">{why}</span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] text-faint tabular-nums">
                    {price(model.inputPerM)} in
                    <br />
                    {price(model.outputPerM)} out
                  </span>
                  <span className="w-4 shrink-0">{selected && <Check size={15} className="text-[#8db4ff]" />}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[12.5px] font-medium text-mute">{query ? `${models.length} matching` : `All models (${models.length})`}</h3>
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-mute select-none">
            <input type="checkbox" checked={toolsOnly} onChange={(e) => setToolsOnly(e.target.checked)} className="accent-[var(--accent)]" />
            Tool-capable only
          </label>
        </div>
        <ul ref={listRef} role="listbox" aria-label="Models" className="-mx-2">
          {models.map((m, i) => {
            const selected = m.id === value;
            return (
              <li key={m.id} role="option" aria-selected={selected} data-index={i}>
                <button
                  type="button"
                  onClick={() => onPick(m.id)}
                  onMouseEnter={() => setActive(i)}
                  className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", i === active && "bg-raised")}
                >
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block truncate text-[14px]", selected ? "text-[#8db4ff]" : "text-ink")}>{m.label}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-faint">
                      {[m.provider, `${formatContext(m.context)} context`, m.vision && "vision", m.reasoning && "reasoning", !m.tools && "no tools"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] text-mute tabular-nums">
                    {price(m.inputPerM)} / {price(m.outputPerM)}
                  </span>
                  <span className="w-4 shrink-0">{selected && <Check size={14} className="text-[#8db4ff]" />}</span>
                </button>
              </li>
            );
          })}
          {models.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-mute">No models match “{query}”.</li>}
        </ul>
      </section>

      <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-snug text-faint">
        <Sparkles size={13} className="mt-px shrink-0" />
        <span>
          {live ? `Live from Nebius Token Factory. Prices are $ in / out per 1M tokens. ` : "Built-in list. Add NEBIUS_API_KEY for the live catalog. "}
          Auto routing, where Jev picks a model per message, is coming soon.
        </span>
      </p>
    </Drawer>
  );
}

/** The current model as a compact row; Change opens the chooser. */
export function ModelPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const current = state.models.find((m) => m.id === value);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl bg-raised px-4 py-3 text-left transition-colors hover:bg-hover disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] text-ink">{current?.label ?? value.split("/").pop()}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-mute">
            {current
              ? [current.provider, `${formatContext(current.context)} context`, current.inputPerM !== null && `${price(current.inputPerM)} / ${price(current.outputPerM)} per 1M`]
                  .filter(Boolean)
                  .join(" · ")
              : "Not in the current catalog"}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-raised-2 px-3 py-1 text-[12.5px] font-medium text-ink">Change</span>
      </button>
      {current && !current.tools && (
        <p className="mt-1.5 px-1 text-[12.5px] text-warn">This model can’t call tools, so search, memory, connections and the browser won’t work.</p>
      )}
      {open && (
        <ModelDialog
          value={value}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            setOpen(false);
            onChange(id);
          }}
        />
      )}
    </>
  );
}
