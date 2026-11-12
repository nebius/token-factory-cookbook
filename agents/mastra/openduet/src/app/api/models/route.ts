import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { listModels } from "@/lib/server/models";

export async function GET(request: Request) {
  await connection();
  const fresh = new URL(request.url).searchParams.has("refresh");
  return handle(async () => ({ models: await listModels(fresh) }));
}
