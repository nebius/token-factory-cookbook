// Settings from the environment. No server-only import: the MCP server and scripts read it too.
import { z } from "zod";
import { DEFAULT_MODEL, modelLabel } from "./lib/models";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

const schema = z.object({
  /** The public address, for link previews, canonical URLs and the sitemap. */
  SITE_URL: z.string().url().default("http://localhost:3000"),
  NEBIUS_API_KEY: optional,
  NEBIUS_BASE_URL: z.string().url().default("https://api.tokenfactory.us-north1.nebius.com/v1/"),
  NEBIUS_MODEL: z
    .string()
    .optional()
    .transform((v) => v?.trim() || DEFAULT_MODEL),
  GITHUB_TOKEN: optional,
  /** libsql URL: a local file by default, or libsql://… for Turso. */
  DATABASE_URL: z.string().default("file:codetrail.db"),
  DATABASE_AUTH_TOKEN: optional,
  /** Hosted spend cap per UTC day. Unset or 0: no cap (local and self-hosted default). */
  DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),
  /** "none": anyone can read new repos (local and self-hosted default). "github": new reads and questions need GitHub sign-in. */
  AUTH_MODE: z.enum(["none", "github"]).default("none"),
  BETTER_AUTH_SECRET: optional,
  BETTER_AUTH_URL: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  /** Free quota per signed-in account per UTC day. */
  QUOTA_READS_PER_DAY: z.coerce.number().int().min(0).default(3),
  QUOTA_ASKS_PER_DAY: z.coerce.number().int().min(0).default(20),
  /** Self-hosted only: a folder whose subfolders can be read at /_local/<name>, uncommitted changes included. */
  LOCAL_ROOT: optional,
  MAX_REPO_TOKENS: z.coerce.number().int().min(10_000).max(1_000_000).default(700_000),
});

export const env = schema.parse(process.env);

/** The configured model's name as people read it. Stored work names the model that made it (src/lib/models.ts). */
export const MODEL_LABEL = modelLabel(env.NEBIUS_MODEL);
