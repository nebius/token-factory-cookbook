import type { RoomInput } from "@/lib/shared/types";
import { body, handle } from "@/lib/server/http";
import { createRoom } from "@/lib/server/service";

export async function POST(request: Request) {
  return handle(async () => ({ room: await createRoom(await body<RoomInput>(request)) }));
}
