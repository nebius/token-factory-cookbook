// Layers for a map read before reads named them: one small call with only the module list (not the repo), so an
// older map can be drawn as a layered architecture diagram. Saved on the map, so it's free after that.
import { z } from "zod";
import { clampText, type Atlas } from "@/lib/schemas";
import { AIError, chatJSON } from "@/server/ai/nebius";
import { putJSON } from "@/server/store";
import { checkLimitsFor, commitKey, shared, trackedCall, type Prepared } from "./service";

const layersSchema = z.object({ modules: z.array(z.object({ id: z.string(), layer: z.string().min(1) })) });
const layersJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modules"],
  properties: {
    modules: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "layer"], properties: { id: { type: "string" }, layer: { type: "string" } } },
    },
  },
} as const;

const task = (p: Prepared, atlas: Atlas) => `Group the modules of ${p.info.owner}/${p.info.repo} into 3-6 architecture layers, the way an architecture diagram groups its boxes (e.g. "Entry points", "Routing", "Request handling", "Storage", "Build & tests"). Each layer is 1-3 words; modules in one layer use the exact same name. Give every module below exactly one layer.

Modules (id: label, kind. purpose. key files):
${atlas.nodes.map((n) => `- ${n.id}: ${n.label}, ${n.kind}. ${n.purpose} ${n.files.slice(0, 5).join(", ")}`).join("\n")}

Connections:
${atlas.edges.map((e) => `- ${e.from} -> ${e.to}`).join("\n")}`;

export async function addLayers(p: Prepared, atlas: Atlas, who: string): Promise<Atlas> {
  if (atlas.nodes.every((n) => n.layer)) return atlas;
  return shared(`${commitKey(p)}/layers`, async () => {
    await checkLimitsFor(who, "asks");
    const { result } = await trackedCall(p, "ask", "Group the map into layers", (cfg) =>
      chatJSON(cfg, { prefix: [], task: task(p, atlas), schema: layersSchema, jsonSchema: layersJsonSchema, name: "codetrail_layers", effort: "low", maxTokens: 8_000 }),
    );
    // The model may echo a module's label, or change its case: match on either.
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const layer = new Map(result.modules.map((m) => [key(m.id), clampText(m.layer.trim(), 30)]));
    const found = (n: Atlas["nodes"][number]) => layer.get(key(n.id)) ?? layer.get(key(n.label));
    if (!atlas.nodes.some(found)) throw new AIError("The layers didn't match the map's modules. Please try again.", "invalid_output");
    const next: Atlas = { ...atlas, nodes: atlas.nodes.map((n) => ({ ...n, layer: found(n) || "Other" })) };
    await putJSON(`${commitKey(p)}/atlas.json`, next);
    return next;
  });
}
