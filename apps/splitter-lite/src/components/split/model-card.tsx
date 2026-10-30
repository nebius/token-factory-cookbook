"use client";

import { Cpu } from "lucide-react";
import * as React from "react";
import { site } from "@/config/site";
import type { ModelInfo } from "@/server/ai/pricing";

type ModelBody = { model: string; endpoint: string; configured: boolean; info: ModelInfo | null };

let cached: Promise<ModelBody | null> | undefined;
export function useModel() {
  const [body, setBody] = React.useState<ModelBody | null>(null);
  React.useEffect(() => {
    cached ??= fetch("/api/model")
      .then((r) => (r.ok ? (r.json() as Promise<ModelBody>) : null))
      .catch(() => null);
    void cached.then(setBody);
  }, []);
  return body;
}

/** The model, its settings and its price, as published by Nebius Token Factory's catalog. */
export function ModelCard() {
  const body = useModel();
  const info = body?.info;
  return (
    <section className="grid gap-3 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-5">
      <span className="flex size-10 items-center justify-center rounded-full border border-border bg-muted">
        <Cpu className="size-4" />
      </span>
      <div className="grid gap-2">
        <p>
          <a href={site.modelUrl} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">
            {site.model}
          </a>{" "}
          <span className="font-mono text-xs text-muted-foreground">{body?.model ?? "nvidia/Nemotron-3.5-Super-VL"}</span>
        </p>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-muted-foreground">
          <dt>Reasoning</dt>
          <dd className="text-foreground">On (Token Factory default for this model)</dd>
          <dt>Price</dt>
          <dd className="text-foreground">
            {info ? `$${info.inputPerM.toFixed(2)} / 1M input · $${info.outputPerM.toFixed(2)} / 1M output tokens` : body ? "Not available from the catalog" : "Loading…"}
          </dd>
          <dt>Tools</dt>
          <dd className="text-foreground">check_receipt · allocate_tax_tip · calculate_split · validate_total</dd>
        </dl>
        {info && (
          <p className="text-xs text-muted-foreground">
            Prices from Token Factory&apos;s <code className="font-mono">/v1/models?verbose=true</code> ({info.modality}, {info.features.join(" + ")}). Every AI call
            below shows its own tokens and cost.
          </p>
        )}
      </div>
    </section>
  );
}
