// GitHub sign-in for the hosted app (AUTH_MODE=github). Self-hosted and local runs default to AUTH_MODE=none,
// where nobody signs in and Better Auth is never created.
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { env } from "@/env";
import { db, dbReady, schema } from "@/server/db";

function createAuth() {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    socialProviders:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {},
    session: { expiresIn: 60 * 60 * 24 * 30, cookieCache: { enabled: true, maxAge: 60 * 5 } },
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Better Auth, created on first use and only when sign-in is on. */
export function getAuth() {
  if (env.AUTH_MODE !== "github") return null;
  instance ??= createAuth();
  return instance;
}

type Viewer = { id: string; name: string; image: string | null };

/** The signed-in user for this request, or null (always null when AUTH_MODE=none). */
export async function viewerOf(headers: Headers): Promise<Viewer | null> {
  const auth = getAuth();
  if (!auth) return null;
  await dbReady();
  const session = await auth.api.getSession({ headers }).catch(() => null);
  return session ? { id: session.user.id, name: session.user.name, image: session.user.image ?? null } : null;
}
