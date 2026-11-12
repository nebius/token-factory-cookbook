// What the model returns, as zod (validation, types) and as strict JSON schema (sent to Token Factory).
// Shared by the server, the browser and the MCP server.
import { z } from "zod";

const NODE_KINDS = ["entry", "interface", "core", "data", "integration", "ui", "config", "tooling", "tests", "docs"] as const;

// Length limits are soft: an over-long field is trimmed here instead of failing validation, because a
// repair turn resends the whole repository (a second full-price call when the cache is cold).

/** Cuts at the last sentence end before `max` when there is one, otherwise at a word. */
export function clampText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max - 1).trimEnd()}…`;
}

const text = (max: number) => z.string().min(1).transform((s) => clampText(s, max));
const upTo = <T extends z.ZodType>(item: T, max: number) => z.array(item).transform((a) => a.slice(0, max));
/** A suggested question: just the question, even when the model went on to answer it. */
const question = z
  .string()
  .min(1)
  .transform((s) => {
    const q = s.trim();
    const end = q.indexOf("?");
    return clampText(end > 0 ? q.slice(0, end + 1) : q, 200);
  });

export const tourSchema = z.object({
  title: text(100),
  summary: text(600),
  steps: z
    .array(
      z.object({
        node: z.string(),
        title: text(80),
        file: z.string().min(1),
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
        anchor: z.string().min(1),
        narration: text(600),
      }),
    )
    .min(2)
    .transform((a) => a.slice(0, 14)),
  /** Questions to ask next (optional: tours stored before follow-ups have none). */
  followUps: z
    .array(z.string())
    .optional()
    .transform((a) => a?.map((q) => clampText(q, 140)).filter((q) => q.length > 3).slice(0, 3)),
});
export type TourAnswer = z.infer<typeof tourSchema>;

export const tourJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "steps", "followUps"],
  properties: {
    title: { type: "string", description: "3-6 words" },
    followUps: { type: "array", items: { type: "string" }, description: "2-3 short questions (under 15 words) a developer would ask after this tour" },
    summary: { type: "string", description: "One or two sentences that answer the question (under 50 words)." },
    steps: {
      type: "array",
      description: "4-12 steps in the order things actually happen when the code runs.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["node", "title", "file", "startLine", "endLine", "anchor", "narration"],
        properties: {
          node: { type: "string", description: "id of the module this step is in" },
          title: { type: "string", description: "2-6 words" },
          file: { type: "string", description: "Exact file path from the repository" },
          startLine: { type: "integer" },
          endLine: { type: "integer", description: "At most 40 lines after startLine" },
          anchor: { type: "string", description: "One distinctive line copied exactly from the file inside startLine-endLine, without the line-number prefix" },
          narration: { type: "string", description: "1-2 sentences: what happens here and why it matters for the question." },
        },
      },
    },
  },
} as const;

export const atlasSchema = z.object({
  summary: text(900),
  stack: upTo(z.string(), 12),
  nodes: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        label: text(40),
        kind: z.enum(NODE_KINDS),
        /** The architecture layer it sits in ("Routing", "Storage"…). Reads before layers existed don't have one. */
        layer: text(30).optional(),
        purpose: text(300),
        files: upTo(z.string(), 15).pipe(z.array(z.string()).min(1)),
      }),
    )
    .min(2)
    .transform((a) => a.slice(0, 16)),
  edges: upTo(z.object({ from: z.string(), to: z.string(), label: text(40) }), 40),
  tours: upTo(z.object({ title: text(80), question }), 6).pipe(z.array(z.object({ title: z.string(), question: z.string() })).min(1)),
  /** The first suggested tour, traced in the same call: one read of the repo gives the map and the main flow. */
  firstTour: tourSchema,
});
export type AtlasAnswer = z.infer<typeof atlasSchema>;

export const atlasJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "stack", "nodes", "edges", "tours", "firstTour"],
  properties: {
    summary: { type: "string", description: "2-3 plain sentences: what this repository is and how it is built." },
    stack: { type: "array", items: { type: "string" }, description: "Main languages, frameworks and libraries, at most 8." },
    nodes: {
      type: "array",
      description: "4-14 modules that make up the system. Every important source file belongs to one.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "kind", "layer", "purpose", "files"],
        properties: {
          id: { type: "string", description: "kebab-case id, unique" },
          label: { type: "string", description: "1-3 words" },
          kind: { type: "string", enum: [...NODE_KINDS] },
          layer: { type: "string", description: "The architecture layer it belongs to, 1-3 words, e.g. 'Entry points', 'Routing', 'Storage', 'Build & tests'. 3-6 layers in total; modules in one layer use the exact same name." },
          purpose: { type: "string", description: "One sentence: what this module does." },
          files: { type: "array", items: { type: "string" }, description: "Exact file paths from the repository, most important first, at most 12." },
        },
      },
    },
    edges: {
      type: "array",
      description: "How modules depend on or call each other.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "label"],
        properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string", description: "2-4 plain words, e.g. 'calls', 'reads config', 'builds context'. No code and no sentences." } },
      },
    },
    tours: {
      type: "array",
      description: "3-5 tours a newcomer would want, each answering one concrete how-does-it-work question.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "question"],
        properties: {
          title: { type: "string", description: "3-6 words" },
          question: { type: "string", description: "The question only, under 20 words. Do not answer it here: the answer is a separate tour." },
        },
      },
    },
    firstTour: { ...tourJsonSchema, description: "A guided tour answering the first question in tours, using the module ids above." },
  },
} as const;

// --- Pull-request tours ----------------------------------------------------------------------------------
const REVIEW_KINDS = ["risk", "test", "question", "nit"] as const;

export const pullSchema = z.object({
  title: text(100),
  summary: text(700),
  steps: tourSchema.shape.steps,
  review: upTo(z.object({ kind: z.enum(REVIEW_KINDS), text: text(400), file: z.string(), line: z.number().int().min(0), anchor: z.string() }), 10),
  modules: upTo(z.string(), 16),
});
export type PullAnswer = z.infer<typeof pullSchema>;

export const pullJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "steps", "review", "modules"],
  properties: {
    title: { type: "string", description: "3-8 words: what this pull request does" },
    summary: { type: "string", description: "2-4 sentences: what changes and why, as the code shows it (under 90 words)." },
    steps: { ...tourJsonSchema.properties.steps, description: "3-10 steps through the changed code in the order it runs, each pointing at the PR's version of a changed file or at unchanged code it plugs into." },
    review: {
      type: "array",
      description: "0-8 things a reviewer should look at, most important first. Only real concerns the code shows; an empty list is fine.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "file", "line", "anchor"],
        properties: {
          kind: { type: "string", enum: [...REVIEW_KINDS], description: "risk: could break something; test: missing or weak test; question: intent unclear; nit: small cleanup" },
          text: { type: "string", description: "One or two sentences, specific to the code." },
          file: { type: "string", description: "Exact path of the file it's about, or empty for the PR as a whole" },
          line: { type: "integer", description: "Line in the PR's version of the file, or 0" },
          anchor: { type: "string", description: "One line copied exactly from that place in the file, or empty" },
        },
      },
    },
    modules: { type: "array", items: { type: "string" }, description: "ids of the modules this PR changes or affects" },
  },
} as const;

export type PullFile = { path: string; status: string; previous?: string; additions: number; deletions: number; patch?: string };

/** A pull request's facts from GitHub's API (no model). */
export type PullFacts = {
  number: number;
  title: string;
  /** The author's description, trimmed. */
  body: string;
  author: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  baseRef: string;
  baseSha: string;
  headSha: string;
  /** owner/repo the head commit lives in (a fork, or the repo itself); null when the fork was deleted. */
  headRepo: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  htmlUrl: string;
  files: PullFile[];
};

/** A reviewer's note on a PR. `checked`: its file and quoted line were found in the PR's version of the code. */
export type ReviewNote = { kind: (typeof REVIEW_KINDS)[number]; text: string; file: string | null; line: number | null; checked: boolean };

/** What the PR view needs before any model call: facts, what would be sent, and the estimate. */
export type PullView = {
  facts: PullFacts;
  /** The stored tour for this head commit, if someone already made it. */
  tourId: string | null;
  /** Tokens the PR adds after the cached repo, and what was left out to fit. */
  tokens: number;
  sent: { head: number; patches: number; left: string[] };
  estimate: { cached: number | null; cold: number | null };
};

export type PullIndexEntry = { id: string; number: number; title: string; headSha: string; steps: number; review: number; cost: number | null; at: number };

/** A step after checking: the line range is the one the anchor really sits in. */
export type Step = Omit<TourAnswer["steps"][number], "anchor"> & {
  anchor: string;
  corrected: boolean;
  /** Brought over from an earlier commit whose quoted line is gone here: shown at its old place, with a warning. */
  stale?: boolean;
};
/** A step that points at code. Hand-written and CodeTour tours can also have text-only steps (an intro, a summary),
 * stored with an empty `file`: no code panel, no place on the map. */
export const onCode = (s: { file: string }) => s.file !== "";

export type Usage = { input: number; cached: number; output: number };

/** One model call, priced from Token Factory's live price list. */
export type CallRecord = {
  id: string;
  kind: "atlas" | "tour" | "ask" | "pr";
  label: string;
  model: string;
  usage: Usage;
  /** Dollars; null when the model wasn't on the price list. */
  cost: number | null;
  /** Dollars cached input saved on this call (cached tokens at the input price minus the cached price). */
  saved?: number | null;
  ms: number;
  at: number;
  attempts: number;
};

export type Atlas = Omit<AtlasAnswer, "edges" | "firstTour"> & {
  /** Edges also backed by imports in the code (from → to module ids), so the map can show them as verified. */
  edges: (AtlasAnswer["edges"][number] & { verified: boolean })[];
  call: CallRecord;
};

export type Tour = Omit<TourAnswer, "steps" | "followUps"> & {
  id: string;
  /** "codetour": written by the repo's maintainers as a VS Code CodeTour file, imported and checked. "custom": written
   * (or edited from another tour) by someone on this instance, each step checked against the code. */
  source?: "codetour" | "custom";
  /** The maintainers' first tour (CodeTour's isPrimary, or main.tour). */
  primary?: boolean;
  question: string;
  steps: Step[];
  /** Steps whose line range was moved to where the anchor really is, and steps dropped as unverifiable. */
  check: { corrected: number; dropped: number };
  calls: CallRecord[];
  /** Set on a pull-request tour: the PR it explains, with a reviewer's notes and the modules it touches. */
  pull?: PullFacts;
  review?: ReviewNote[];
  modules?: string[];
  /** Questions the model suggested asking next. */
  followUps?: string[];
  /** Brought over from the read of an earlier commit: how many steps moved with their code, and how many went stale. */
  carriedFrom?: { sha: string; moved: number; stale: number };
};

export type Price = { input: number; cached: number; output: number };

export type RepoSummary = {
  owner: string;
  repo: string;
  /** The folders this read covers, when not all of them (a scope string, src/lib/scope.ts). */
  scope?: string;
  description: string | null;
  stars: number;
  ref: string;
  sha: string;
  htmlUrl: string;
  private: boolean;
  languages: Record<string, number>;
  files: { total: number; read: number; compressed: number; overBudget: number; skipped: number; secrets: number; images: string[] };
  /** Tokens of the packed repository: estimated until the first read, then Token Factory's real count. */
  tokens: number;
  tokensMeasured?: boolean;
  lines: number;
  model: string;
  modelLabel: string;
  price: Price | null;
  /** Today's prices of every model on Token Factory, so a call made with an earlier model is priced as that model. */
  prices?: Record<string, Price>;
  /** Dollars: map + main tour (one call), a tour served from the prompt cache, and one that misses it. */
  estimate: { firstRead: number | null; followUp: number | null; followUpCold: number | null };
  entries: string[];
  graphEdges: number;
  /** Read-only details for the "what was read" drawer. */
  read: string[];
  /** Files sent as signatures only (didn't fit whole). */
  compressed: string[];
  /** Every file read as [path, lines, tokens], in read order: the treemap and the file graph use it. */
  fileSizes: [string, number, number][];
  /** Text files in the commit that weren't sent whole: [path, lines, "signatures" | "left out"]. Still browsable. */
  otherFiles: [string, number, "signatures" | "left out"][];
  /** Import links between read files, as indexes into fileSizes (worked out from the code). */
  imports: [number, number][];
  /** The line of the import behind each entry of `imports` (same order), when known. */
  importLines?: (number | null)[];
  overBudget: string[];
  skippedSample: { path: string; reason: string }[];
};

/** A tour stored for a commit, listed so everyone opening the repo can replay it for free. */
export type TourIndexEntry = { id: string; title: string; question: string; steps: number; cost: number | null; at: number; source?: "codetour" | "custom"; primary?: boolean };
