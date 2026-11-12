// Who's signed in, and how much of today's free quota is left. Drives the header and the sign-in prompt.
import { NextResponse } from "next/server";
import { env } from "@/env";
import { viewerOf } from "@/server/auth";
import { usageOf } from "@/server/quota";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const viewer = await viewerOf(req.headers);
  const usage = viewer ? await usageOf(`user:${viewer.id}`) : null;
  return NextResponse.json({
    mode: env.AUTH_MODE,
    viewer,
    usage: usage ? { reads: usage.reads, asks: usage.asks } : null,
    limits: { reads: env.QUOTA_READS_PER_DAY, asks: env.QUOTA_ASKS_PER_DAY },
  });
}
