import type { RoomInput } from "@/lib/shared/types";
import { body, handle } from "@/lib/server/http";
import { deleteRoom, updateRoom } from "@/lib/server/service";

export async function PATCH(request: Request, ctx: RouteContext<"/api/rooms/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => ({ room: await updateRoom(id, await body<Partial<RoomInput>>(request)) }));
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/rooms/[id]">) {
  const { id } = await ctx.params;
  return handle(() => deleteRoom(id));
}
