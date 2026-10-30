// Rename the app in one place.
export const site = {
  name: "Splitter Lite",
  tagline: "Snap the bills. The AI reads them, then splits them with calculator tools.",
  description:
    "Upload one or two bills, say who had what in plain English, and Nemotron 3.5 Super VL reads every line and works out each share with calculator tool calls.",
  /** The full app this is cut down from. */
  originalName: "Splitter",
  repoUrl: "https://github.com/Studio1-OSS/Splitter",
  deployedUrl: "https://ten-splitter.vercel.app",
  author: "Amitesh Anand",
  nebiusUrl: "https://tokenfactory.nebius.com",
  defaultCurrency: "USD",
  /** Display name of the AI model (the model id itself is NEBIUS_MODEL on the server). */
  model: "Nemotron 3.5 Super VL",
  /** The model's page on Token Factory. */
  modelUrl: "https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=nvidia/Nemotron-3.5-Super-VL",
} as const;
