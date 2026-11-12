import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const BODY = "M20 2.5c9.9 0 17.5 7.4 17.5 17.1 0 10-7.7 17.9-17.5 17.9S2.5 29.6 2.5 19.6C2.5 9.9 10.1 2.5 20 2.5z";
const SMILE = "M18.2 25.6c1.1 1.1 2.3 1.6 3.6 1.6s2.5-.5 3.6-1.6";

/** Home-screen icon: the OpenDuet mark, two mascots on a white tile (same as docs/logo.svg). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff" }}>
        <svg width="180" height="180" viewBox="0 0 64 64">
          <g transform="translate(12 12) scale(.9)">
            <path d={BODY} fill="#e0663d" />
            <ellipse cx="13" cy="11" rx="4.5" ry="2.6" fill="#ffffff" opacity="0.22" transform="rotate(-28 13 11)" />
            <rect x="16.2" y="14.2" width="3.4" height="6.6" rx="1.7" fill="#101010" />
            <rect x="23.4" y="13.6" width="3.4" height="6.6" rx="1.7" fill="#101010" />
            <path d={SMILE} stroke="#101010" strokeWidth="1.7" strokeLinecap="round" fill="none" />
          </g>
          <g transform="translate(35 35) scale(.6)">
            <path d={BODY} fill="#f5cbb9" stroke="#ffffff" strokeWidth="3" />
            <rect x="16.2" y="14.2" width="3.4" height="6.6" rx="1.7" fill="#161616" />
            <rect x="23.4" y="13.6" width="3.4" height="6.6" rx="1.7" fill="#161616" />
            <path d={SMILE} stroke="#161616" strokeWidth="1.7" strokeLinecap="round" fill="none" />
          </g>
        </svg>
      </div>
    ),
    size,
  );
}
