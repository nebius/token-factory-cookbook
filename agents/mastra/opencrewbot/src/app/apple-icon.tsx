import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the mascot on the app's dark background. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#111111" }}>
        <svg width="132" height="132" viewBox="0 0 40 40">
          <path d="M20 2.5c9.9 0 17.5 7.4 17.5 17.1 0 10-7.7 17.9-17.5 17.9S2.5 29.6 2.5 19.6C2.5 9.9 10.1 2.5 20 2.5z" fill="#3478f6" />
          <ellipse cx="13" cy="11" rx="4.5" ry="2.6" fill="#ffffff" opacity="0.25" transform="rotate(-28 13 11)" />
          <rect x="16.2" y="14.2" width="3.4" height="6.6" rx="1.7" fill="#0f1220" />
          <rect x="23.4" y="13.6" width="3.4" height="6.6" rx="1.7" fill="#0f1220" />
          <path d="M18.2 25.6c1.1 1.1 2.3 1.6 3.6 1.6s2.5-.5 3.6-1.6" stroke="#0f1220" strokeWidth="1.7" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    ),
    size,
  );
}
