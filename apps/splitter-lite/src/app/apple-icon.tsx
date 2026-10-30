import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS home-screen icon: the logo mark on a full-bleed square (iOS rounds the corners itself).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <svg width="180" height="180" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" fill="#17171c" />
        <path d="M30 14A18 18 0 1 0 50 34H30Z" fill="#ffffff" />
        <path d="M34.5 10.5A20 20 0 0 1 53.5 29.5H34.5Z" fill="#ff7759" />
      </svg>
    ),
    size,
  );
}
