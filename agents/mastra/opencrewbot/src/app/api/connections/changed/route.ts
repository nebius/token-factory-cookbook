import { handle } from "@/lib/server/http";
import { connectionsChanged } from "@/lib/server/connectors";

/** Called after a Composio sign-in returns, so bots reload their app tools. */
export async function POST() {
  return handle(() => connectionsChanged());
}
