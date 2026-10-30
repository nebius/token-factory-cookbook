import { connection } from "next/server";
import { appStatus } from "@/lib/server/config";
import { listBots, listRooms } from "@/lib/server/db";
import { handle } from "@/lib/server/http";
import { listModels } from "@/lib/server/models";
import { summaries } from "@/lib/server/service";
import { liveViews } from "@/lib/server/browserbase";
import { upcomingRoutines } from "@/lib/server/proactive";

export async function GET() {
  await connection();
  return handle(async () => {
    const [bots, rooms, conversations, models, routines] = await Promise.all([listBots(), listRooms(), summaries(), listModels(), upcomingRoutines()]);
    return { status: appStatus(), bots, rooms, conversations, models, routines, liveViews: liveViews() };
  });
}
