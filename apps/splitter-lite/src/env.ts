import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

const schema = z.object({
  NEBIUS_API_KEY: optional,
  NEBIUS_BASE_URL: z.string().url().default("https://api.tokenfactory.us-north1.nebius.com/v1/"),
  NEBIUS_MODEL: z.string().default("nvidia/Nemotron-3.5-Super-VL"),
  /** AI requests (bill reads + splits) one visitor can make per 10 minutes. Protects a shared demo. */
  AI_REQUESTS_PER_10_MIN: z.coerce.number().int().min(1).default(40),
});

export const env = schema.parse(process.env);

export const features = {
  scanning: Boolean(env.NEBIUS_API_KEY),
};
