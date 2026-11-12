// /owner/repo/slides.html: the slides as one standalone HTML file to download and present anywhere. Free.
import { slidesHtml } from "@/server/trail/slides";
import { loadSlides } from "../slides/load";

export async function GET(req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const data = await loadSlides(owner, repo, new URL(req.url).searchParams.get("sha") ?? undefined);
  if (!data) return new Response("Not read on this Codetrail yet.", { status: 404 });
  return new Response(slidesHtml(data.slides, `${data.name} · slides`), {
    headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="${data.name.replace("/", "-")}-slides.html"` },
  });
}
