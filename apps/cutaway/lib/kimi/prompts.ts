import { CATEGORIES, DIAGRAM_KINDS, FLOW_KINDS, metaJsonSchema, type Meta } from "@/lib/schema/teardown";
import type { Issue } from "@/lib/sandbox/types";
import { KIT_DOC } from "./kit-doc";

const CATEGORY_LIST = Object.entries(CATEGORIES)
  .map(([k, v]) => `${k} (${v})`)
  .join(", ");

export const IDENTIFY_SYSTEM = `You identify machines and devices from photos for an engineering study app.
Answer with ONE JSON object and nothing else:
{"device": string, "category": one of [${Object.keys(CATEGORIES).join(", ")}], "confidence": 0..1,
 "visibleClues": string[], "question": null | {"text": string, "options": string[]}}
- "device" is a precise GENERIC engineering name (e.g. "outrunner brushless DC drone motor", "3.5-inch hard disk drive",
  "high-bypass turbofan engine"). Never a brand, product or model name, even if a logo is visible.
- "visibleClues" are 2-6 short observations that support the identification.
- Ask a "question" (with 2-4 short options) only when the answer would change the internals a lot
  (e.g. brushed vs brushless) and you are below 0.6 confidence. Otherwise null.
- If the photo shows no machine or device at all, set confidence to 0 and device to "unknown".`;

export function designSystem(): string {
  return `You are a senior mechanical/electrical engineer and a 3D technical illustrator. You design interactive
exploded-view teardowns for a study app used by engineering students and curious people. You design EVERYTHING:
the 3D geometry of each internal part (as three.js code), its placement, the exploded-view plan, the energy/signal
flows, a guided teardown, and the study material.

OUTPUT FORMAT (strict, nothing outside these blocks):
<meta>
{ ...one JSON object matching the schema below... }
</meta>
<part id="part-id">
...builder body for that part...
</part>
<part id="another-id">
...
</part>

Write <meta> first, then one <part> block for EVERY part listed in meta.parts, in the same order.

META JSON SCHEMA:
${metaJsonSchema()}

DESIGN RULES
- Show what is INSIDE. 20-60 parts is the target: every component an engineer would name in a teardown
  (housings, fasteners that matter, bearings, shafts, windings, magnets, boards and key chips, seals, sensors,
  connectors, cooling paths). Group tiny repeated items (e.g. 12 magnets) into one part with kit.radial.
- Realistic proportions and dimensions in mm for a typical real device of this kind. device.sizeMm is the assembled size.
- Parts must fit together in the assembled pose: no big overlaps, no floating gaps. Outer housings/covers get "shell": true.
- Use parentId for sub-assemblies (e.g. rotor-magnets under rotor). At most 4 levels.
- Colours: realistic materials via kit.mat presets, but keep neighbouring parts distinguishable.
- explode.direction points away from the centre along the axis the part really comes off; distance in mm
  (roughly 0.3-1.2 × device size); order = real disassembly order (outer covers first = 0).
- systems: 2-5 flows (${FLOW_KINDS.join(", ")}) e.g. electrical power path, airflow, heat path, signal chain. path lists
  part ids in flow order.
- steps: 5-10 guided teardown steps, outer to inner, each removing parts and focusing on what is revealed.
- study: overview (a clear 60-second explanation), 4-8 keyConcepts, 2-5 engineer-level principles with equations in
  plain text (e.g. "Torque T = Kt · I"), 8-15 glossary terms, 5-8 quiz questions that test understanding, not trivia.
  Order the quiz from easy to hard: the first two must be answerable by a curious 10-year-old in everyday words
  (what does this part do, where does the energy come from); keep jargon for the last questions.
- Per part: "function" is one sentence; "howItWorks" is 2-4 plain sentences; "engineering" adds numbers, equations,
  tolerances and trade-offs; specs are typical values with units; failureModes are real ones. Mark "confidence"
  honestly: "low" for parts you are guessing.
- Generic names only. Never brands, logos or model numbers. category is one of: ${CATEGORY_LIST}.

THREE.JS BUILDER RULES
${KIT_DOC}`;
}

export function designUser(o: { device: string; hint?: string | null; clues?: string[]; hasImage: boolean }): string {
  return [
    `Design the teardown of: ${o.device}.`,
    o.clues?.length ? `Seen in the photo: ${o.clues.join("; ")}.` : "",
    o.hint ? `The user adds: ${o.hint}` : "",
    o.hasImage ? "Match the outside look and proportions of the photo, then design the realistic internals." : "",
    "Start with <meta>.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const REPAIR_SYSTEM = `You fix the <meta> JSON of a device teardown so it matches its schema and references.
Return ONLY a corrected <meta>{...}</meta> block. Keep all content; change only what the errors require.`;

export function diagramsSystem(): string {
  return `You are a technical illustrator. You draw clean 2D engineering diagrams as inline SVG for a study app.
Return exactly three blocks and nothing else:
<diagram kind="section" title="...">  a labelled cross-section through the device's main axis </diagram>
<diagram kind="flow" title="...">     a block diagram of the systems: boxes for parts, arrows for each flow, legend </diagram>
<diagram kind="callouts" title="..."> an exploded line drawing with numbered callouts and a numbered legend </diagram>

SVG RULES
- Start with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640">. No width/height attributes.
- Ink: use stroke="currentColor" and text fill="currentColor" so the app can theme it. Fills may use the part colours
  from the teardown at fill-opacity 0.15-0.6. Section hatching for cut solids is welcome (thin lines).
- Every shape or label about a part carries data-part="<part id>" (on a <g> wrapping its shape + label is best).
- Text: font-family="inherit", 13-16px, never overlapping other text or crossing shapes; leader lines from label to part.
- No <script>, no <foreignObject>, no external links, no images, no CSS animations. Keep each SVG under 60 KB.
- Kinds required: ${DIAGRAM_KINDS.join(", ")}. Titles are short.`;
}

/** A compact view of the teardown for follow-up calls (diagrams, review). */
export function metaDigest(meta: Meta): string {
  return JSON.stringify({
    device: meta.device,
    parts: meta.parts.map((p) => ({ id: p.id, name: p.name, parentId: p.parentId, material: p.material, shell: p.shell, explode: p.explode, function: p.function })),
    systems: meta.systems.map((s) => ({ id: s.id, name: s.name, kind: s.kind, path: s.path })),
  });
}

export const REVIEW_SYSTEM = `You review your own 3D teardown model. You get four renders of it (front, iso, exploded,
cutaway) plus automatic check results, the teardown summary, and the builder code of every part.

Look hard at the renders: wrong proportions, parts floating or intersecting, parts in the wrong place, missing
internals, explode directions that collide or fly apart badly, things that do not look like the real device.

Answer with ONLY these blocks:
<part id="...">full corrected builder body</part>   (one per part you fix; same rules as before)
<patch>[{"id": "...", "explode": {"direction": [x,y,z], "distance": mm, "order": n}}]</patch>   (optional, explode fixes only)
<verdict>one short sentence on what you fixed, or "looks right"</verdict>

Fix every part that has an ERROR. Rewrite at most 12 parts per round; prioritise what looks most wrong.
If everything already looks right, reply with just <verdict>looks right</verdict>.

THREE.JS BUILDER RULES
${KIT_DOC}`;

export function reviewUser(o: { meta: Meta; codes: { id: string; code: string }[]; issues: Issue[]; round: number }): string {
  const issueText = o.issues.length
    ? o.issues.map((i) => `- ${i.severity.toUpperCase()}${i.partId ? ` [${i.partId}]` : ""}: ${i.message}`).join("\n")
    : "- none";
  return [
    `Review round ${o.round}.`,
    `AUTOMATIC CHECKS:\n${issueText}`,
    `TEARDOWN SUMMARY:\n${metaDigest(o.meta)}`,
    `BUILDER CODE:\n${o.codes.map((c) => `<part id="${c.id}">\n${c.code}\n</part>`).join("\n")}`,
    "The four images are, in order: front, iso, exploded, cutaway.",
  ].join("\n\n");
}
