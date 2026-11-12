import { z } from "zod";

export const CATEGORIES = {
  "motors-power": "Motors & Power",
  electronics: "Electronics & Semiconductors",
  "phones-computers": "Phones & Computers",
  "home-appliances": "Home Appliances",
  aerospace: "Aerospace",
  automotive: "Automotive",
  other: "Other machines",
} as const;
export type Category = keyof typeof CATEGORIES;
const categoryIds = Object.keys(CATEGORIES) as [Category, ...Category[]];

export const FLOW_KINDS = ["current", "air", "heat", "signal", "fluid", "force"] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];

export const VIEWS = ["front", "back", "left", "right", "top", "iso"] as const;
export type ViewName = (typeof VIEWS)[number];

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/, "ids are lowercase kebab-case, max 48 chars");

export const PartSchema = z.object({
  id,
  name: z.string().min(1),
  parentId: id.nullable().default(null),
  function: z.string().min(1).describe("one sentence: what this part is for"),
  howItWorks: z.string().min(1).describe("2-4 sentences in plain language"),
  engineering: z.string().default("").describe("deeper detail for engineers: equations, tolerances, design trade-offs"),
  material: z.string().min(1),
  shell: z.boolean().default(false).describe("true for outer housings/covers that hide the inside"),
  explode: z.object({
    direction: Vec3.describe("unit-ish vector, device coordinates, Y up"),
    distance: z.number().min(0).describe("mm to move when fully exploded"),
    order: z.number().int().min(0).describe("disassembly order, 0 comes off first"),
  }),
  specs: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  failureModes: z.array(z.string()).default([]),
  // Small enum slips fall back to a default instead of failing the whole answer (and costing a repair call).
  confidence: z.enum(["high", "medium", "low"]).catch("medium").describe("how sure you are this part exists and looks like this"),
});

export const SystemSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(FLOW_KINDS).catch("force"),
  path: z.array(id).min(2).describe("part ids in the order the flow passes through them"),
  explanation: z.string(),
});

export const StepSchema = z.object({
  title: z.string(),
  narration: z.string().describe("one or two sentences read during this step"),
  removePartIds: z.array(id).default([]).describe("parts taken off in this step (they stay hidden for later steps)"),
  focusPartIds: z.array(id).default([]),
  view: z.enum(VIEWS).default("iso").catch("iso"),
});

export const StudySchema = z.object({
  overview: z.string().describe("the 60-second explanation of how the whole device works"),
  keyConcepts: z.array(z.object({ title: z.string(), body: z.string() })).default([]),
  principles: z.array(z.object({ title: z.string(), body: z.string() })).default([]).describe("engineer-level physics/maths with equations in plain text"),
  glossary: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
  quiz: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).min(2).max(5),
        answer: z.number().int().min(0),
        explanation: z.string(),
        partIds: z.array(id).default([]),
      }),
    )
    .default([]),
});

export const DeviceSchema = z.object({
  name: z.string().min(1).describe("generic name, never a brand or product name"),
  category: z.enum(categoryIds).catch("other"),
  summary: z.string().describe("one line"),
  sizeMm: Vec3.describe("overall assembled size [x, y, z] in mm"),
  disclaimer: z.string().default("Representative internals of this kind of device, not an exact copy of one product."),
});

export const MetaSchema = z.object({
  device: DeviceSchema,
  parts: z.array(PartSchema).min(1).max(160),
  systems: z.array(SystemSchema).default([]),
  steps: z.array(StepSchema).default([]),
  study: StudySchema,
});

export const IdentitySchema = z.object({
  device: z.string().min(1),
  category: z.enum(categoryIds).catch("other"),
  confidence: z.number().min(0).max(1),
  visibleClues: z.array(z.string()).default([]),
  question: z
    .object({ text: z.string(), options: z.array(z.string()).default([]) })
    .nullable()
    .default(null),
});

export type Part = z.infer<typeof PartSchema>;
export type FlowSystem = z.infer<typeof SystemSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Study = z.infer<typeof StudySchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type Identity = z.infer<typeof IdentitySchema>;

export const DIAGRAM_KINDS = ["section", "flow", "callouts"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];
export type Diagram = { kind: DiagramKind; title: string; svg: string };

/** JSON schema of the metadata block, pasted into the design prompt. */
export function metaJsonSchema(): string {
  return JSON.stringify(z.toJSONSchema(MetaSchema, { io: "input" }));
}

export function categoryLabel(c: string): string {
  return (CATEGORIES as Record<string, string>)[c] ?? CATEGORIES.other;
}
