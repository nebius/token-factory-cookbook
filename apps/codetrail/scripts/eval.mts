// Small end-to-end check: map + first suggested tour per repo, with cost, cache share and step checks.
// pnpm eval owner/repo [owner/repo ...]   (costs real money: about $0.05-0.25 per repo on first read)
import "dotenv/config";
import { parseRepoInput } from "../src/lib/ref";
import { getAtlas, getTour, prepare } from "../src/server/trail/service";
import { formatUsd } from "../src/lib/format";
import type { CallRecord } from "../src/lib/schemas";

const line = (c: CallRecord) =>
  `${c.kind.padEnd(5)} ${formatUsd(c.cost ?? 0).padStart(8)}  in ${c.usage.input.toLocaleString()} (cached ${Math.round((c.usage.cached / Math.max(1, c.usage.input)) * 100)}%)  out ${c.usage.output.toLocaleString()}  ${(c.ms / 1000).toFixed(1)}s  attempts ${c.attempts}`;

for (const arg of process.argv.slice(2)) {
  const ref = parseRepoInput(arg);
  if (!ref) continue;
  const p = await prepare(ref);
  console.log(`\n# ${p.info.owner}/${p.info.repo}@${p.info.sha.slice(0, 7)}  ~${p.summary.tokens.toLocaleString()} tokens, estimate ${formatUsd(p.summary.estimate.firstRead ?? 0)} first read`);
  const { atlas, fromCache } = await getAtlas(p, "eval");
  console.log(fromCache ? "atlas  (stored)" : line(atlas.call));
  console.log(`  ${atlas.nodes.length} modules, ${atlas.edges.length} edges (${atlas.edges.filter((e) => e.verified).length} confirmed by imports)`);
  console.log(`  ${atlas.summary}`);
  for (const t of atlas.tours) console.log(`  - ${t.title}: ${t.question}`);
  const { tour, fromCache: tc } = await getTour(p, atlas, atlas.tours[0].question, "eval");
  console.log(tc ? "tour   (stored)" : line(tour.calls[0]));
  console.log(`  "${tour.title}": ${tour.steps.length} steps, ${tour.check.corrected} line ranges corrected, ${tour.check.dropped} dropped`);
  for (const s of tour.steps) console.log(`   ${s.node.padEnd(16)} ${s.file}:${s.startLine}-${s.endLine}${s.corrected ? " *" : ""}  ${s.title}`);
}
