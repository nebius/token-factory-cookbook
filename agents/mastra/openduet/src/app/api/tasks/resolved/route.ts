import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { resolvedTasks } from "@/lib/server/service";

export async function GET() {
  await connection();
  return handle(async () => ({ tasks: await resolvedTasks() }));
}
