// Tours written by hand, like CodeTour's recorder: a title, then steps that each point at lines of a file. Free (no
// model call). Each step is checked like a generated one: the file must be in the commit and the range must fit,
// and its first non-blank line becomes the anchor that keeps it honest. A step can also be text only (an intro).
import { z } from "zod";
import type { Atlas, Step, Tour, TourIndexEntry } from "@/lib/schemas";
import { putJSON } from "@/server/store";
import { nodeForFile } from "./ground";
import { commitKey, getTourIndex, questionIdOf, type Prepared } from "./service";

export const customTourInput = z.object({
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().max(600).default(""),
  steps: z
    .array(
      z.object({
        /** Empty for a text-only step. */
        file: z.string().max(500),
        startLine: z.number().int().min(0),
        endLine: z.number().int().min(0),
        title: z.string().trim().min(1).max(120),
        narration: z.string().trim().max(1200).default(""),
      }),
    )
    .min(1)
    .max(40),
});
type CustomTourInput = z.infer<typeof customTourInput>;

const MAX_RANGE = 120;

/** The steps, checked against the commit's files; problems name the step. */
export function checkCustomSteps(input: CustomTourInput, files: Map<string, string>, atlas: Pick<Atlas, "nodes">): { steps: Step[]; problems: string[] } {
  const nodes = atlas.nodes.map((n) => ({ id: n.id, files: n.files }));
  const steps: Step[] = [];
  const problems: string[] = [];
  input.steps.forEach((s, i) => {
    const text = files.get(s.file);
    const label = `Step ${i + 1} ("${s.title}")`;
    if (!s.file) {
      if (!s.narration) return problems.push(`${label}: a text step needs some text.`);
      return steps.push({ node: "", title: s.title, file: "", startLine: 0, endLine: 0, anchor: "", narration: s.narration, corrected: false });
    }
    if (text === undefined) return problems.push(`${label}: ${s.file} isn't a file in this commit.`);
    const lines = text.split("\n");
    if (s.startLine < 1 || s.startLine > lines.length) return problems.push(`${label}: ${s.file} has ${lines.length} lines; line ${s.startLine} doesn't exist.`);
    const end = Math.min(Math.max(s.endLine, s.startLine), lines.length, s.startLine + MAX_RANGE - 1);
    const anchor = lines.slice(s.startLine - 1, end).find((l) => l.trim())?.trim() ?? "";
    steps.push({ node: nodeForFile(s.file, nodes) ?? "", title: s.title, file: s.file, startLine: s.startLine, endLine: end, anchor, narration: s.narration, corrected: false });
  });
  return { steps, problems };
}

/** Saves a hand-written tour for this commit and lists it with the others. */
export async function saveCustomTour(p: Prepared, atlas: Atlas, input: CustomTourInput): Promise<{ tour: Tour; tours: TourIndexEntry[] } | { problems: string[] }> {
  const files = new Map(p.snapshot.files.map((f) => [f.path, f.text]));
  const { steps, problems } = checkCustomSteps(input, files, atlas);
  if (problems.length) return { problems };
  const id = questionIdOf(`custom:${input.title}:${Date.now()}`);
  const tour: Tour = { id, source: "custom", question: input.title, title: input.title, summary: input.summary, steps, check: { corrected: 0, dropped: 0 }, calls: [] };
  await putJSON(`${commitKey(p)}/tours/${id}.json`, tour);
  const tours = [...(await getTourIndex(p.info)), { id, title: tour.title, question: tour.question, steps: steps.length, cost: 0, at: Date.now(), source: "custom" as const }];
  await putJSON(`${commitKey(p)}/tours.json`, tours);
  return { tour, tours };
}
