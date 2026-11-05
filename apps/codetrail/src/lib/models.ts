// The open models Codetrail runs on (NEBIUS_MODEL picks one), and their names as people read them. Every call
// record keeps the model that made it, so receipts, exports and the data page name the right one after a switch.

export const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

const LABELS: Record<string, string> = {
  "deepseek-ai/DeepSeek-V4.1-Flash-1017": "DeepSeek V4.1 Flash 1017",
  "moonshotai/Kimi-K3.1-Pro": "Kimi K3.1 Pro",
};

/** "Kimi K3.1 Pro" for "moonshotai/Kimi-K3.1-Pro"; another model's id without its owner, hyphens as spaces. */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return LABELS[DEFAULT_MODEL];
  return LABELS[id] ?? id.split("/").pop()!.replace(/-/g, " ");
}

/** Every model that made at least one of these calls, by name, in the order first used. */
export const modelsOf = (calls: { model: string }[]) => [...new Set(calls.map((c) => modelLabel(c.model)))];

/** " with Kimi K3.1 Pro" for a credit line ("Answered by Codetrail with …"); "" when no model call made it (a person did). */
export const withModels = (calls: { model: string }[]) => (calls.length ? ` with ${modelsOf(calls).join(" and ")}` : "");
