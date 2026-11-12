// The trail card: a 1200×630 image of a tour (route over the module map, hike-style stats, an elevation
// profile of where in each file the steps sit). Used for sharing and as the link preview.
import { ImageResponse } from "next/og";
import { font } from "@/server/og";
import { KIND_COLOR, SUPPORT } from "@/lib/palette";
import { onCode, type Tour } from "@/lib/schemas";
import { getLedger, getStoredAtlas, getStoredTour, getTourIndex, latestReadSha, prepare } from "@/server/trail/service";
import { modelLabel } from "@/lib/models";

export const maxDuration = 60;

const INK = "#08090b";
const FG = "#eeece6";
const FG3 = "#7a7d86";
const LINE = "#22252c";
const TRAIL = "#ffb020";


export async function GET(req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const id = new URL(req.url).searchParams.get("tour");
  // The latest read, not the branch head: tours live with the commit they were traced on.
  const p = await latestReadSha(owner, repo)
    .then((ref) => prepare({ owner, repo, ref }))
    .catch(() => null);
  if (!p) return new Response("Not found", { status: 404 });
  const atlas = await getStoredAtlas(p.info);
  const index = await getTourIndex(p.info);
  const tourId = id && /^[0-9a-f]{12}$/.test(id) ? id : index[0]?.id;
  const tour: Tour | null = tourId ? await getStoredTour(p.info, tourId) : null;
  const ledger = await getLedger(p.info);

  const lines = new Map(p.summary.fileSizes.map(([path, l]) => [path, l]));
  const title = tour?.question ?? `${owner}/${repo}`;
  // Text-only steps have no place on the map or in a file.
  const steps = (tour?.steps ?? []).filter(onCode);
  const call = tour?.calls[0];
  // The model that read this repo (the map behind the card), not whichever one is configured today.
  const model = modelLabel(atlas?.call.model).toUpperCase();
  const record = call ? ledger.find((c) => c.id === call.id) ?? call : null;
  const pull = tour?.pull;
  const stats = pull
    ? [
        { label: "STEPS", value: String(steps.length) },
        { label: "FILES CHANGED", value: String(pull.changedFiles) },
        { label: "LINES", value: `+${pull.additions} -${pull.deletions}` },
        { label: "TIME", value: record ? `${(record.ms / 1000).toFixed(1)}s` : "—" },
        { label: "COST", value: record?.cost != null ? `$${record.cost < 0.01 ? record.cost.toFixed(4) : record.cost.toFixed(3)}` : "—" },
        { label: "REVIEW NOTES", value: String(tour.review?.length ?? 0) },
      ]
    : tour
    ? [
        { label: "STEPS", value: String(steps.length) },
        { label: "FILES", value: String(new Set(steps.map((s) => s.file)).size) },
        { label: "LINES COVERED", value: String(steps.reduce((a, s) => a + s.endLine - s.startLine + 1, 0)) },
        { label: "TIME", value: record ? `${(record.ms / 1000).toFixed(1)}s` : "—" },
        { label: record?.kind === "atlas" ? "COST · MAP + TOUR" : "COST", value: record?.cost != null ? `$${record.cost < 0.01 ? record.cost.toFixed(4) : record.cost.toFixed(3)}` : "—" },
        { label: "LINES CHECKED", value: `${steps.length} / ${steps.length}` },
      ]
    : [
        { label: "FILES READ", value: String(p.summary.files.read) },
        { label: "TOKENS", value: `${Math.round(p.summary.tokens / 1000)}K` },
        { label: "MODULES", value: String(atlas?.nodes.length ?? "—") },
      ];

  // The module map: nodes on a ring, the tour's route through them in order.
  const nodes = atlas?.nodes ?? [];
  const pos = new Map(nodes.map((n, i) => [n.id, { x: 235 + Math.cos((i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2) * 150, y: 330 + Math.sin((i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2) * 170 }]));
  const route = steps.map((s) => pos.get(s.node)).filter((q): q is { x: number; y: number } => !!q);
  const visited = new Set(steps.map((s) => s.node));

  // Elevation: how far down its file each step starts.
  const W = 640;
  const H = 120;
  const pts = steps.map((s, i) => ({ x: 10 + (i * (W - 20)) / Math.max(1, steps.length - 1), y: H - 8 - (s.startLine / Math.max(s.startLine, lines.get(s.file) ?? s.endLine)) * (H - 24) }));
  const linePath = pts.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
  const areaPath = pts.length ? `${linePath} L${pts.at(-1)!.x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z` : "";

  const text = `${title}${owner}${repo}codetrail${stats.map((s) => s.label + s.value).join("")}${nodes.map((n) => n.label).join("")}${model}WHERE IN THE FILE EACH STEP SITS0123456789/·.$ READ WHOLE BY PR #+-`;
  // Subset the font to the characters used, in both cases (labels are upper-cased).
  const glyphs = [...new Set(text + text.toUpperCase())].join("");
  const [mono, monoBold] = await Promise.all([font("Martian Mono", 400, glyphs), font("Martian Mono", 700, glyphs)]).catch(() => [null, null]);

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", background: INK, color: FG, fontFamily: mono ? "Martian" : "sans-serif" }}>
        <div style={{ width: 470, height: 630, display: "flex", position: "relative", borderRight: `1px solid ${LINE}` }}>
          <svg width="470" height="630" viewBox="0 0 470 630">
            <ellipse cx="235" cy="330" rx="200" ry="220" fill="none" stroke="rgba(255,176,32,0.14)" />
            <ellipse cx="235" cy="330" rx="140" ry="160" fill="none" stroke="rgba(255,176,32,0.14)" />
            {route.length > 1 && <polyline points={route.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={TRAIL} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 10" />}
            {nodes.map((n) => {
              const q = pos.get(n.id)!;
              const on = visited.has(n.id);
              return <circle key={n.id} cx={q.x} cy={q.y} r={on ? 16 : 10} fill={on ? KIND_COLOR[n.kind] ?? SUPPORT : "#2a2e36"} stroke={INK} strokeWidth="4" />;
            })}
            {route[0] && <circle cx={route[0].x} cy={route[0].y} r="9" fill={TRAIL} stroke={INK} strokeWidth="3" />}
          </svg>
          {nodes
            .filter((n) => visited.has(n.id))
            .map((n) => {
              const q = pos.get(n.id)!;
              return (
                <div key={n.id} style={{ position: "absolute", left: Math.min(330, Math.max(10, q.x - 70)), top: q.y + 22, width: 140, display: "flex", justifyContent: "center", fontSize: 11, color: FG }}>
                  {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
                </div>
              );
            })}
          <div style={{ position: "absolute", left: 30, top: 28, display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 700, color: FG }}>
            <svg width="24" height="24" viewBox="0 0 26 26">
              <circle cx="13" cy="13" r="12" fill="none" stroke={TRAIL} strokeWidth="2" />
              <circle cx="20" cy="8" r="2.4" fill={TRAIL} />
            </svg>
            codetrail
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "36px 42px 30px" }}>
          <div style={{ fontSize: 14, letterSpacing: 2, color: FG3 }}>{`${owner} / ${repo} · ${pull ? `PR #${pull.number}` : p.info.sha.slice(0, 7)}`.toUpperCase()}</div>
          <div style={{ marginTop: 14, fontSize: title.length > 70 ? 28 : 34, lineHeight: 1.15, fontWeight: 700, letterSpacing: -1, display: "flex" }}>{title}</div>
          <div style={{ marginTop: 26, display: "flex", flexWrap: "wrap", rowGap: 16 }}>
            {stats.map((s, i) => (
              <div key={s.label} style={{ width: "33%", display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: FG3 }}>{s.label}</div>
                <div style={{ fontSize: 30, fontWeight: 700, color: i === 4 ? TRAIL : FG }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column" }}>
            {pts.length > 1 && (
              <div style={{ display: "flex", flexDirection: "column", width: W }}>
                <div style={{ display: "flex", width: W, fontSize: 11, letterSpacing: 2, color: FG3 }}>WHERE IN THE FILE EACH STEP SITS</div>
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 8 }}>
                  <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke={LINE} />
                  <path d={areaPath} fill="rgba(255,176,32,0.16)" />
                  <path d={linePath} fill="none" stroke={TRAIL} strokeWidth="3" strokeLinejoin="round" />
                  {pts.map((q, i) => (
                    <circle key={i} cx={q.x} cy={q.y} r="5" fill={TRAIL} stroke={INK} strokeWidth="2" />
                  ))}
                </svg>
              </div>
            )}
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", fontSize: 12, color: FG3 }}>
              <span>{`READ WHOLE BY ${model}`}</span>
              <span style={{ color: TRAIL }}>{`codetrail · ${owner}/${repo}`}</span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: mono && monoBold ? [{ name: "Martian", data: mono, weight: 400 }, { name: "Martian", data: monoBold, weight: 700 }] : undefined,
      headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
    },
  );
}
