// Rerun the deterministic checks and rebuild model.xlsx for a finished run, without calling the model.
// Usage: pnpm recheck <run-id>
const { finish } = await import("../src/lib/pipeline.ts");
const { loadRun, saveRun } = await import("../src/lib/runs.ts");

const id = process.argv[2];
const run = id ? await loadRun(id) : null;
if (!run) {
  console.error("Usage: pnpm recheck <run-id>");
  process.exit(1);
}
await finish(run);
await saveRun(run);
console.log(JSON.stringify({ summary: run.result?.summary, claimsMarked: run.result?.claims.filter((c) => c.at.lines?.length).length, claims: run.result?.claims.length }, null, 2));
