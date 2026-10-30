import { ImageResponse } from "next/og";
import { site } from "@/config/site";

export const alt = `${site.name}: ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#ffffff", color: "#17171c" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 44 }}>
          <svg width="72" height="72" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="16" fill="#17171c" />
            <path d="M30 14A18 18 0 1 0 50 34H30Z" fill="#ffffff" />
            <path d="M34.5 10.5A20 20 0 0 1 53.5 29.5H34.5Z" fill="#ff7759" />
          </svg>
          {site.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          <div style={{ fontSize: 104, lineHeight: 0.98, letterSpacing: -4, maxWidth: 1000 }}>Snap the bills. The AI splits them.</div>
          <div style={{ display: "flex", gap: 14 }}>
            {["Trips", "Parties", "Events", "Dinners", "Home"].map((t) => (
              <div key={t} style={{ fontSize: 26, color: "#b8401f", border: "2px solid #ff7759", borderRadius: 8, padding: "8px 18px" }}>
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
