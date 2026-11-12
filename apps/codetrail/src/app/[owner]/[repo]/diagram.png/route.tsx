// /owner/repo/diagram.png: the repo's architecture as a 1200×630 card, the link preview when a repo page is shared
// (like GitDiagram's), and a PNG for READMEs that don't show SVG. Drawn from the stored read: free.
import { ImageResponse } from "next/og";
import { env } from "@/env";
import { architectureSpec, diagramSvg, layoutDiagram } from "@/lib/diagram";
import { LOCAL_OWNER } from "@/lib/ref";
import type { Atlas } from "@/lib/schemas";
import type { RepoInfo } from "@/server/repo/github";
import { font } from "@/server/og";
import { getJSON } from "@/server/store";
import { latestReadSha, storeKey } from "@/server/trail/service";

export const maxDuration = 60;

const W = 1200;
const H = 630;

export async function GET(_req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const sha = owner === LOCAL_OWNER ? undefined : await latestReadSha(owner, repo);
  const commit = sha ? storeKey(owner, repo, sha) : null;
  const [atlas, info] = commit ? await Promise.all([getJSON<Atlas>(`${commit}/atlas.json`), getJSON<RepoInfo>(`${commit}/info.json`)]) : [null, null];
  if (!atlas || !info || (info.private && env.AUTH_MODE !== "none")) return new Response("Not found", { status: 404 });

  const layout = await layoutDiagram(architectureSpec(atlas));
  const svg = diagramSvg(layout, "light");
  // Fit the diagram into the space under the title, keeping its proportions.
  const boxW = W - 96, boxH = H - 180;
  const k = Math.min(boxW / (layout.w + 16), boxH / (layout.h + 16), 1.4);
  const title = `${info.owner}/${info.repo}`;
  const glyphs = `${title}${info.description ?? ""}0123456789,.·architecture stars codetrail`;
  const [mono, monoBold] = await Promise.all([font("Martian Mono", 400, glyphs), font("Martian Mono", 700, glyphs)]).catch(() => [null, null]);

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: "#f6f3ec", padding: "36px 48px", fontFamily: "Martian" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, color: "#16171a", letterSpacing: -1 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 18, color: "#6b6e76" }}>{info.stars.toLocaleString("en")} stars</div>
        </div>
        <div style={{ display: "flex", marginTop: 6, fontSize: 18, color: "#4a4d55", maxWidth: 1000 }}>{(info.description ?? "").slice(0, 110)}</div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", marginTop: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`} width={Math.round((layout.w + 16) * k)} height={Math.round((layout.h + 16) * k)} alt="" />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: "#6b6e76" }}>
          <span>architecture · {sha!.slice(0, 7)}</span>
          <span style={{ color: "#935000", fontWeight: 700 }}>codetrail</span>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: mono && monoBold ? [{ name: "Martian", data: mono, weight: 400 }, { name: "Martian", data: monoBold, weight: 700 }] : undefined,
      headers: { "cache-control": "public, max-age=3600" },
    },
  );
}
