import { extractJson, parseTagged } from "./parse";
import { DIAGRAM_KINDS, MetaSchema, type Diagram, type DiagramKind, type Meta } from "@/lib/schema/teardown";
import { checkSvg } from "@/lib/check/meta";

/** Turn a stored design answer (and optional diagrams answer) into the pieces the app stores. */
export function fromResponses(designText: string, diagramsText = ""): { meta: Meta; parts: { id: string; code: string }[]; diagrams: Diagram[] } {
  const blocks = parseTagged(designText);
  const metaBlock = blocks.find((b) => b.tag === "meta");
  if (!metaBlock) throw new Error("no <meta> block");
  const meta = MetaSchema.parse(extractJson(metaBlock.body));
  const parts = blocks.flatMap((b) => (b.tag === "part" ? [{ id: b.id, code: b.body }] : []));
  const diagrams = parseTagged(diagramsText).flatMap((b) =>
    b.tag === "diagram" && DIAGRAM_KINDS.includes(b.kind as DiagramKind) && !checkSvg(b.body)
      ? [{ kind: b.kind as DiagramKind, title: b.title || b.kind, svg: b.body }]
      : [],
  );
  return { meta, parts, diagrams };
}
