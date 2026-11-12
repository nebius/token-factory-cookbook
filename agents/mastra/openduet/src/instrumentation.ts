// Runs once when the server starts. Bots' briefs and check-ins are scheduled
// here, so they happen whether or not the app is open in a browser.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { PHASE_PRODUCTION_BUILD } = await import("next/constants");
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  const { startScheduler } = await import("./lib/server/proactive");
  startScheduler();
}
