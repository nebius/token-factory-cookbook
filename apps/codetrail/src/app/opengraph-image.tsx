// The site's link preview: the headline over a dotted route, in the trail map style.
import { ImageResponse } from "next/og";
import { font } from "@/server/og";
import { MODEL_LABEL } from "@/env";

export const alt = `Codetrail: diagram, docs, code tour and Q&A for any GitHub repo, read whole by ${MODEL_LABEL}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const lines = ["Every repo is a trail.", "Walk it.", "Diagram, docs, code tour and Q&A, in one link.", `${MODEL_LABEL.toUpperCase()} · READS THE WHOLE REPO`, "codetrail"];
  const text = lines.join("");
  const [light, bold] = await Promise.all([font("Martian Mono", 300, text), font("Martian Mono", 800, text)]).catch(() => [null, null]);
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#08090b", color: "#eeece6", fontFamily: light ? "Martian" : "sans-serif", position: "relative" }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M900 640 C 940 580, 960 500, 1000 470 S 1080 380, 1100 290 S 1140 120, 1180 60" fill="none" stroke="#ffb020" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 18" />
          <circle cx="1000" cy="470" r="10" fill="#eeece6" stroke="#08090b" strokeWidth="4" />
          <circle cx="1100" cy="290" r="10" fill="#eeece6" stroke="#08090b" strokeWidth="4" />
          <circle cx="1180" cy="60" r="12" fill="#ffb020" />
        </svg>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 800 }}>
          <svg width="36" height="36" viewBox="0 0 26 26">
            <circle cx="13" cy="13" r="12" fill="none" stroke="#ffb020" strokeWidth="2" />
            <circle cx="20" cy="8" r="2.4" fill="#ffb020" />
          </svg>
          codetrail
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 64, fontWeight: 300, letterSpacing: -4, lineHeight: 1.05 }}>Every repo is a trail.</div>
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -4, color: "#ffb020", lineHeight: 1.05 }}>Walk it.</div>
          <div style={{ marginTop: 26, fontSize: 26, color: "#a9abb2" }}>Diagram, docs, code tour and Q&A, in one link.</div>
        </div>
        <div style={{ fontSize: 16, letterSpacing: 3, color: "#7a7d86" }}>{`${MODEL_LABEL.toUpperCase()} · READS THE WHOLE REPO`}</div>
      </div>
    ),
    { ...size, fonts: light && bold ? [{ name: "Martian", data: light, weight: 300 }, { name: "Martian", data: bold, weight: 800 }] : undefined },
  );
}
