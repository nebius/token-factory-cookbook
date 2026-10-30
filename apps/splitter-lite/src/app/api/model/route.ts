import { env, features } from "@/env";
import { modelInfo } from "@/server/ai/pricing";
import { aiConfig } from "@/server/ai/request";

export const runtime = "nodejs";

/** The model in use and its Token Factory catalog entry (price, features). No AI call. */
export async function GET() {
  const info = features.scanning ? await modelInfo(aiConfig()) : null;
  return Response.json({ model: env.NEBIUS_MODEL, endpoint: env.NEBIUS_BASE_URL, configured: features.scanning, info });
}
