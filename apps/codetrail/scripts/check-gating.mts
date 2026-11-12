// Checks hosted gating without a model call: pnpm tsx scripts/check-gating.mts (sets AUTH_MODE=github itself).
process.env.AUTH_MODE = "github";
process.env.QUOTA_READS_PER_DAY = "3";
await import("dotenv/config");
const { getAtlas, getStoredAtlas, prepare } = await import("../src/server/trail/service");
const { takeQuota } = await import("../src/server/quota");

const stored = await prepare({ owner: "lukeed", repo: "polka" });
const a = await getAtlas(stored, "anon:1.2.3.4");
console.log("stored repo, anonymous:", a.fromCache ? "served free from storage" : "UNEXPECTED new read");

// A repo with no stored map, so a new read is what's being asked for.
let fresh = null;
for (const repo of ["uvu", "clsx", "klona", "tinydate", "sade"]) {
  const p = await prepare({ owner: "lukeed", repo });
  if (!(await getStoredAtlas(p.info))) {
    fresh = p;
    break;
  }
}
if (!fresh) throw new Error("No unread repo left to test with; add another to the list.");
try {
  await getAtlas(fresh, "anon:1.2.3.4");
  console.log("UNEXPECTED: anonymous new read allowed");
} catch (e) {
  console.log("new repo, anonymous:", (e as Error).name, "→", (e as Error).message.slice(0, 60));
}

const who = `user:test-${Date.now()}`;
for (let i = 1; i <= 4; i++) {
  try {
    await takeQuota(who, "reads");
    console.log(`read ${i}: allowed`);
  } catch (e) {
    console.log(`read ${i}:`, (e as Error).name);
  }
}
process.exit(0);
