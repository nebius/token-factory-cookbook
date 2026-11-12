import { body, handle } from "@/lib/server/http";
import { disconnectApp } from "@/lib/server/composio";
import { connectionsChanged } from "@/lib/server/connectors";
import { InputError } from "@/lib/server/errors";

export async function POST(request: Request) {
  return handle(async () => {
    const { slug } = await body<{ slug: string }>(request);
    if (!slug) throw new InputError("Pick an app to disconnect.");
    await disconnectApp(slug);
    await connectionsChanged();
  });
}
