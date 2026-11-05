import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => new Date()),
};

// ── Better Auth tables (field names must match Better Auth's core schema) ──────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ...timestamps,
});

// ── App tables ────────────────────────────────────────────────────────────────────────

/** Totals per UTC day for the whole site: what the model read, what it cost, what caching saved. */
export const stats = sqliteTable("stats", {
  day: text("day").primaryKey(),
  reads: integer("reads").notNull().default(0),
  tours: integer("tours").notNull().default(0),
  replays: integer("replays").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  usd: real("usd").notNull().default(0),
  savedUsd: real("saved_usd").notNull().default(0),
});

/** New AI work per account per day, for the hosted app's free quota. `who` is a user id, or "ip:<addr>". */
export const usage = sqliteTable(
  "usage",
  {
    who: text("who").notNull(),
    day: text("day").notNull(),
    reads: integer("reads").notNull().default(0),
    asks: integer("asks").notNull().default(0),
    usd: real("usd").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.who, t.day] })],
);

/**
 * Everything derived from a repo after it's been read, as JSON by key: facts, maps, tours, answers, docs,
 * indexes. Keys look like "repos/<owner>/<repo>/<sha>/atlas.json".
 */
export const artifacts = sqliteTable("artifacts", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** Every text file of every commit read, for the code panel, the file browser and full-text search (FTS5). */
export const repoFiles = sqliteTable(
  "repo_files",
  {
    commit: text("commit_key").notNull(),
    path: text("path").notNull(),
    text: text("text").notNull(),
    lines: integer("lines").notNull(),
  },
  (t) => [primaryKey({ columns: [t.commit, t.path] })],
);

/** One row per model call, priced: the cost ledger behind receipts and the data page. */
export const calls = sqliteTable(
  "calls",
  {
    id: text("id").primaryKey(),
    commit: text("commit_key").notNull(),
    record: text("record").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("calls_commit_idx").on(t.commit, t.at)],
);
