// The hosted app's free quota: new repo reads and questions per account per UTC day, counted in the database
// so every server instance sees the same numbers. Stored repos and tours never count.
import { and, eq, sql } from "drizzle-orm";
import { env } from "@/env";
import { db, dbReady, schema } from "@/server/db";
import { today } from "@/server/stats";

export type QuotaKind = "reads" | "asks";

export class AuthRequiredError extends Error {
  constructor(message = "Sign in with GitHub to read new repos and ask questions. Stored repos and tours stay free without signing in.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class QuotaError extends Error {
  constructor(kind: QuotaKind) {
    super(
      kind === "reads"
        ? `You've read ${env.QUOTA_READS_PER_DAY} new repos today, the free daily limit. Stored repos still open, and the limit resets at midnight UTC.`
        : `You've asked ${env.QUOTA_ASKS_PER_DAY} questions today, the free daily limit. Stored tours still open, and the limit resets at midnight UTC.`,
    );
    this.name = "QuotaError";
  }
}

const limitOf = (kind: QuotaKind) => (kind === "reads" ? env.QUOTA_READS_PER_DAY : env.QUOTA_ASKS_PER_DAY);

export async function usageOf(who: string) {
  await dbReady();
  const row = await db.query.usage.findFirst({ where: and(eq(schema.usage.who, who), eq(schema.usage.day, today())) });
  return { reads: row?.reads ?? 0, asks: row?.asks ?? 0, usd: row?.usd ?? 0 };
}

/** Checks the quota and counts one use. Throws QuotaError when today's limit is reached. */
export async function takeQuota(who: string, kind: QuotaKind) {
  const used = await usageOf(who);
  if (used[kind] >= limitOf(kind)) throw new QuotaError(kind);
  const u = schema.usage;
  await db
    .insert(u)
    .values({ who, day: today(), [kind]: 1 })
    .onConflictDoUpdate({ target: [u.who, u.day], set: { [kind]: sql`${u[kind]} + 1` } });
}
