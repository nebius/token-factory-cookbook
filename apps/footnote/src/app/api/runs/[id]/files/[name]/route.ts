import { loadRun, readRunFile } from "@/lib/runs";

export const runtime = "nodejs";

// Images the model looked at, and the deliverables. Documents are always downloads, never rendered here.
const FILES: Record<string, (name: string) => { type: string; download?: string } | null> = {
  jpg: (n) => (/^view-\d+-\d+\.jpg$/.test(n) ? { type: "image/jpeg" } : null),
  xlsx: (n) => (n === "model.xlsx" ? { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", download: "xlsx" } : null),
  pdf: (n) => (n === "document.pdf" || n === "document-b.pdf" ? { type: "application/pdf", download: "pdf" } : null),
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await ctx.params;
  const kind = FILES[name.split(".").pop() ?? ""]?.(name);
  if (!kind) return new Response("Not found", { status: 404 });
  try {
    const body = await readRunFile(id, name);
    const headers: Record<string, string> = { "Content-Type": kind.type, "Cache-Control": "private, no-cache" };
    if (kind.download) {
      const run = await loadRun(id);
      const docName = name === "document-b.pdf" ? run?.docB?.name : run?.doc.name;
      const base = (docName ?? "footnote").replace(/[^\w .-]+/g, "").trim().slice(0, 80) || "footnote";
      headers["Content-Disposition"] = `attachment; filename="${base}${kind.download === "xlsx" ? " (Footnote model)" : ""}.${kind.download}"`;
    }
    return new Response(new Uint8Array(body), { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
