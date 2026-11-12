import { body, handle } from "@/lib/server/http";
import { connectApp } from "@/lib/server/composio";
import { InputError } from "@/lib/server/errors";

export async function POST(request: Request) {
  return handle(async () => {
    const { slug } = await body<{ slug: string }>(request);
    if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) throw new InputError("Pick an app to connect.");
    // Composio sends the person back here after they sign in; the app shows a toast and refreshes.
    const callbackUrl = `${new URL(request.url).origin}/?connected=${encodeURIComponent(slug)}`;
    return { redirectUrl: await connectApp(slug, callbackUrl) };
  });
}
