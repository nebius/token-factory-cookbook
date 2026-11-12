import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { dbReady } from "@/server/db";

async function handle(req: Request, method: "GET" | "POST") {
  const auth = getAuth();
  if (!auth) return new Response("Sign-in is off on this instance.", { status: 404 });
  await dbReady();
  return toNextJsHandler(auth)[method](req);
}

export const GET = (req: Request) => handle(req, "GET");
export const POST = (req: Request) => handle(req, "POST");
