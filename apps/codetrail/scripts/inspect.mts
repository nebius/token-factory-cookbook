// Prints what Codetrail would read for a repo, with no AI call: pnpm tsx scripts/inspect.mts owner/repo
import "dotenv/config";
import { parseRepoInput } from "../src/lib/ref";
import { prepare } from "../src/server/trail/service";
import { formatUsd } from "../src/lib/format";

const ref = parseRepoInput(process.argv[2] ?? "");
if (!ref) throw new Error("Usage: inspect.mts owner/repo");
const t = Date.now();
const p = await prepare(ref);
const s = p.summary;
console.log(`${s.owner}/${s.repo}@${s.sha.slice(0, 7)} in ${Date.now() - t}ms`);
console.log(`files: ${s.files.read} read / ${s.files.total} total, ${s.files.overBudget} over budget, ${s.files.skipped} skipped, images: ${s.files.images.join(", ") || "none"}`);
console.log(`~${s.tokens.toLocaleString()} tokens, ${s.lines.toLocaleString()} lines`);
console.log(`estimate: first read ${s.estimate.firstRead === null ? "?" : formatUsd(s.estimate.firstRead)}, follow-up ${s.estimate.followUp === null ? "?" : formatUsd(s.estimate.followUp)}`);
console.log(`entries: ${s.entries.join(", ")}`);
console.log(`import edges: ${s.graphEdges}`);
console.log(`first files: ${p.pack.included.slice(0, 12).map((f) => f.path).join(", ")}`);
