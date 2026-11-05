import { Cog, Droplets, Flame, Radio, Wind, Zap, type LucideIcon } from "lucide-react";
import type { FlowKind } from "@/lib/schema/teardown";

/** Plain words for things the model names technically. */
export const FLOW_WORDS: Record<FlowKind, { label: string; icon: LucideIcon; verb: string }> = {
  current: { label: "Electricity", icon: Zap, verb: "See where the electricity goes" },
  air: { label: "Air", icon: Wind, verb: "See how the air moves" },
  heat: { label: "Heat", icon: Flame, verb: "See where the heat goes" },
  force: { label: "Motion", icon: Cog, verb: "See how the movement passes along" },
  signal: { label: "Signals", icon: Radio, verb: "See how the signals travel" },
  fluid: { label: "Liquid", icon: Droplets, verb: "See where the liquid flows" },
};

export const CONFIDENCE_WORDS = {
  high: { label: "Certain", tone: "badge-ok", hint: "Kimi is sure: this part is in almost every machine like this." },
  medium: { label: "Likely", tone: "badge-warn", hint: "Most machines like this have this part, but it can look different." },
  low: { label: "A guess", tone: "badge-err", hint: "Kimi isn't certain this part looks like this. Treat it as a guess." },
} as const;


/** Manual-style part numbers (1, 2, 3…) in the order Kimi listed the parts; the same number shows in the list, on the 3D tags and on the part page. */
export function partNumbers(parts: { id: string }[]): Map<string, number> {
  return new Map(parts.map((p, i) => [p.id, i + 1]));
}
