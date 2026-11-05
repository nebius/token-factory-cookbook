// Module colours: a categorical palette validated for colour-blind separation on the dark surface (dataviz
// validator, all checks pass). Amber stays out: it only ever means "the active step". Supporting kinds
// share one grey, and every node also names its kind in text, so colour is never the only cue.
export const PALETTE = ["#3987e5", "#199e70", "#9085e9", "#d55181", "#008300", "#e66767"] as const;
export const SUPPORT = "#6a7380";

export const KIND_COLOR: Record<string, string> = {
  core: PALETTE[0],
  entry: PALETTE[1],
  interface: PALETTE[2],
  data: PALETTE[3],
  integration: PALETTE[4],
  ui: PALETTE[5],
  config: SUPPORT,
  tooling: SUPPORT,
  tests: SUPPORT,
  docs: SUPPORT,
};
