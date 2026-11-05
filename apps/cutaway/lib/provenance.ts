/** Teardowns that did not come from a live Kimi call: hand-made fixtures and replays of them. */
export function isTestData(provider: string | null | undefined): boolean {
  return provider === "fixture" || provider === "replay";
}
