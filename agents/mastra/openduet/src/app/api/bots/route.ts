import type { BotInput } from "@/lib/shared/types";
import { body, handle } from "@/lib/server/http";
import { createBot } from "@/lib/server/service";

export async function POST(request: Request) {
  return handle(async () => ({ bot: await createBot(await body<BotInput>(request)) }));
}
