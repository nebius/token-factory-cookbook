import { z } from "zod";
import { checkMeta, checkSvg } from "@/lib/check/meta";
import {
  deleteParts,
  findReadyByNameKey,
  getIdentityCache,
  getInput,
  getParts,
  getTeardown,
  nextVersion,
  saveDiagrams,
  setIdentityCache,
  setPartResults,
  setThumbnail,
  slugTaken,
  updateTeardown,
  upsertParts,
  type Teardown,
} from "@/lib/db/teardowns";
import { DIAGRAM_KINDS, IdentitySchema, MetaSchema, PartSchema, type Diagram, type DiagramKind, type Identity, type Meta } from "@/lib/schema/teardown";
import type { Issue } from "@/lib/sandbox/types";
import { nameKey, slugify } from "@/lib/slug";
import { imagePart, kimiChat, kimiConfig, KimiError, type ContentPart } from "./client";
import { extractJson, parseTagged, TaggedStreamParser } from "./parse";
import {
  IDENTIFY_SYSTEM,
  REPAIR_SYSTEM,
  REVIEW_SYSTEM,
  designSystem,
  designUser,
  diagramsSystem,
  metaDigest,
  reviewUser,
} from "./prompts";

export const MAX_REVIEW_ROUNDS = 2;

function must(id: number): Teardown {
  const t = getTeardown(id);
  if (!t) throw new KimiError(`teardown ${id} not found`, "config");
  return t;
}

function inputImageUrl(id: number): string | null {
  const input = getInput(id);
  return input?.image ? `data:${input.mime ?? "image/jpeg"};base64,${input.image.toString("base64")}` : null;
}

export type IdentifyResult = { identity: Identity; cached: boolean; existing: { slug: string; name: string } | null };

/** Photo → what device it is. Cached per photo hash; text input needs no model call. */
export async function identify(id: number): Promise<IdentifyResult> {
  const t = must(id);
  const input = getInput(id);
  let identity = t.input_kind === "image" ? getIdentityCache(t.input_hash) : null;
  const cached = !!identity;
  if (!identity) {
    if (t.input_kind === "text") {
      identity = { device: (input?.text ?? "").trim(), category: "other", confidence: 1, visibleClues: [], question: null };
    } else {
      updateTeardown(id, { status: "identifying", error: null });
      const url = inputImageUrl(id);
      if (!url) throw new KimiError("this teardown has no photo", "config");
      const res = await kimiChat({
        teardownId: id,
        kind: "identify",
        maxTokens: 8000,
        messages: [
          { role: "system", content: IDENTIFY_SYSTEM },
          { role: "user", content: [{ type: "text", text: "What device is this?" }, imagePart(url)] },
        ],
      });
      const parsed = IdentitySchema.safeParse(extractJson(res.text));
      if (!parsed.success) throw new KimiError(`identify answer did not match: ${z.prettifyError(parsed.error)}`, "invalid_output");
      identity = parsed.data;
      setIdentityCache(t.input_hash, identity);
    }
  }
  const key = nameKey(identity.device);
  updateTeardown(id, { status: "identified", identity, name: identity.device, name_key: key, category: identity.category, error: null });
  const ready = findReadyByNameKey(key);
  return { identity, cached, existing: ready && ready.id !== id ? { slug: ready.slug, name: ready.name ?? ready.slug } : null };
}

export type DesignEvent =
  | { type: "progress"; chars: number; reasoningChars: number }
  | { type: "meta"; meta: Meta }
  | { type: "part"; id: string; code: string }
  | { type: "repair"; message: string }
  | { type: "done"; slug: string; partCount: number; issues: Issue[]; truncated: boolean }
  | { type: "error"; message: string };

function parseMeta(body: string): { meta: Meta | null; error: string | null } {
  try {
    const r = MetaSchema.safeParse(extractJson(body));
    return r.success ? { meta: r.data, error: null } : { meta: null, error: z.prettifyError(r.error) };
  } catch (e) {
    return { meta: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Pick the slug and version: a new device gets a fresh slug; the same device again becomes the next version. */
function settleSlug(t: Teardown, meta: Meta): { slug: string; version: number } {
  if (!t.slug.startsWith("draft-")) return { slug: t.slug, version: t.version };
  const key = nameKey(meta.device.name);
  const base = slugify(meta.device.name);
  let slug = base;
  for (let n = 2; slugTaken(slug, key); n++) slug = `${base}-${n}`;
  return { slug, version: nextVersion(slug) };
}

/** The main call: Kimi designs the metadata and every part's three.js builder. Streams events as blocks close. */
export async function design(id: number, emit: (e: DesignEvent) => void, signal?: AbortSignal): Promise<void> {
  const t = must(id);
  const identity = t.identity;
  if (!identity) throw new KimiError("identify this teardown first", "config");
  updateTeardown(id, { status: "designing", error: null });
  // A restarted design starts clean; parts are saved as they stream so anyone watching sees them appear.
  deleteParts(id);
  const image = t.input_kind === "image" ? inputImageUrl(id) : null;
  const userText = designUser({ device: identity.device, hint: t.hint, clues: identity.visibleClues, hasImage: !!image });
  const content: ContentPart[] = [{ type: "text", text: userText }];
  if (image) content.push(imagePart(image));

  const parser = new TaggedStreamParser();
  let metaBody: string | null = null;
  const codes = new Map<string, string>();
  let chars = 0;
  let lastEmit = 0;

  const res = await kimiChat({
    teardownId: id,
    kind: "design",
    signal,
    messages: [
      { role: "system", content: designSystem() },
      { role: "user", content },
    ],
    onDelta: (d) => {
      chars += d.text.length;
      for (const b of parser.push(d.text)) {
        if (b.tag === "meta") {
          metaBody = b.body;
          const { meta } = parseMeta(b.body);
          if (meta) {
            updateTeardown(id, { meta, name: meta.device.name, category: meta.device.category, summary: meta.device.summary, part_count: meta.parts.length });
            emit({ type: "meta", meta });
          }
        } else if (b.tag === "part") {
          codes.set(b.id, b.body);
          upsertParts(id, [{ id: b.id, code: b.body }]);
          emit({ type: "part", id: b.id, code: b.body });
        }
      }
      if (Date.now() - lastEmit > 400) {
        lastEmit = Date.now();
        emit({ type: "progress", chars, reasoningChars: d.reasoningChars });
      }
    },
  });

  if (!metaBody) throw new KimiError(`Kimi's answer had no <meta> block${res.finishReason === "length" ? " (it ran out of tokens)" : ""}`, "invalid_output");
  let { meta, error } = parseMeta(metaBody);
  if (!meta) {
    emit({ type: "repair", message: "Fixing the metadata so it matches the schema…" });
    const fix = await kimiChat({
      teardownId: id,
      kind: "repair",
      signal,
      maxTokens: 40_000,
      messages: [
        { role: "system", content: REPAIR_SYSTEM },
        { role: "user", content: `SCHEMA ERRORS:\n${error}\n\nMETA TO FIX:\n<meta>\n${metaBody}\n</meta>` },
      ],
    });
    const block = parseTagged(fix.text).find((b) => b.tag === "meta");
    ({ meta, error } = parseMeta(block?.body ?? fix.text));
    if (!meta) throw new KimiError(`metadata still invalid after one repair: ${error}`, "invalid_output");
    emit({ type: "meta", meta });
  }

  const issues = checkMeta(meta, codes.keys());
  const { slug, version } = settleSlug(t, meta);
  const c = kimiConfig();
  // Parts were already saved one by one as they streamed in.
  updateTeardown(id, {
    status: "designed",
    meta,
    slug,
    version,
    name: meta.device.name,
    name_key: nameKey(meta.device.name),
    category: meta.device.category,
    summary: meta.device.summary,
    part_count: meta.parts.length,
    provider: c.provider,
    model: c.model,
  });
  emit({ type: "done", slug, partCount: meta.parts.length, issues, truncated: res.finishReason === "length" });
}

/** Kimi draws the three 2D diagrams from its own teardown. */
export async function diagrams(id: number, signal?: AbortSignal): Promise<{ diagrams: Diagram[]; issues: Issue[] }> {
  const t = must(id);
  if (!t.meta) throw new KimiError("design the teardown first", "config");
  const res = await kimiChat({
    teardownId: id,
    kind: "diagrams",
    signal,
    maxTokens: 64_000,
    messages: [
      { role: "system", content: diagramsSystem() },
      { role: "user", content: `TEARDOWN:\n${metaDigest(t.meta)}\n\nDraw the three diagrams.` },
    ],
  });
  const issues: Issue[] = [];
  const out: Diagram[] = [];
  for (const b of parseTagged(res.text)) {
    if (b.tag !== "diagram") continue;
    const kind = b.kind as DiagramKind;
    if (!DIAGRAM_KINDS.includes(kind)) continue;
    const problem = checkSvg(b.body);
    if (problem) issues.push({ severity: "warning", message: `${kind} diagram: ${problem}` });
    else out.push({ kind, title: b.title || kind, svg: b.body });
  }
  for (const k of DIAGRAM_KINDS) if (!out.some((d) => d.kind === k)) issues.push({ severity: "warning", message: `no usable ${k} diagram` });
  saveDiagrams(id, out);
  return { diagrams: out, issues };
}

const PatchSchema = z.array(z.object({ id: z.string(), explode: PartSchema.shape.explode }));

export type ReviewResult = { fixes: { id: string; code: string }[]; patched: string[]; verdict: string; round: number; meta: Meta };

/** Kimi looks at renders of its own model plus the check results and rewrites what is wrong. */
export async function review(
  id: number,
  o: { images: { front: string; iso: string; exploded: string; cutaway: string }; issues: Issue[]; round: number },
  signal?: AbortSignal,
): Promise<ReviewResult> {
  const t = must(id);
  if (!t.meta) throw new KimiError("design the teardown first", "config");
  if (o.round > MAX_REVIEW_ROUNDS) throw new KimiError(`at most ${MAX_REVIEW_ROUNDS} review rounds`, "config");
  updateTeardown(id, { status: "reviewing", error: null });
  const codes = getParts(id).map((p) => ({ id: p.part_id, code: p.code }));
  const res = await kimiChat({
    teardownId: id,
    kind: "review",
    signal,
    messages: [
      { role: "system", content: REVIEW_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: reviewUser({ meta: t.meta, codes, issues: o.issues, round: o.round }) },
          imagePart(o.images.front),
          imagePart(o.images.iso),
          imagePart(o.images.exploded),
          imagePart(o.images.cutaway),
        ],
      },
    ],
  });
  const blocks = parseTagged(res.text);
  const known = new Set(t.meta.parts.map((p) => p.id));
  const fixes = blocks.flatMap((b) => (b.tag === "part" && known.has(b.id) ? [{ id: b.id, code: b.body }] : []));
  const verdict = blocks.find((b) => b.tag === "verdict")?.body ?? "";
  const patched: string[] = [];
  const meta: Meta = structuredClone(t.meta);
  const patchBlock = blocks.find((b) => b.tag === "patch");
  if (patchBlock) {
    try {
      const patch = PatchSchema.safeParse(extractJson(patchBlock.body));
      if (patch.success) {
        for (const p of patch.data) {
          const part = meta.parts.find((x) => x.id === p.id);
          if (part) {
            part.explode = p.explode;
            patched.push(p.id);
          }
        }
      }
    } catch {
      /* a broken patch is ignored; the code fixes still apply */
    }
  }
  if (fixes.length) upsertParts(id, fixes);
  updateTeardown(id, { review_rounds: o.round, meta, status: "designed" });
  return { fixes, patched, verdict, round: o.round, meta };
}

/** Store the final build results and thumbnail; the teardown becomes visible in the library. */
export function finalize(id: number, o: { results: { id: string; ok: boolean; error?: string | null }[]; thumbnail?: string | null }): Teardown {
  const t = must(id);
  if (!t.meta) throw new KimiError("design the teardown first", "config");
  setPartResults(id, o.results);
  if (o.thumbnail) {
    const m = o.thumbnail.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (m) setThumbnail(id, Buffer.from(m[2], "base64"), m[1]);
  }
  updateTeardown(id, { status: "ready", error: null });
  return must(id);
}
