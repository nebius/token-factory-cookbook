import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // A second build directory lets a production build run beside `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Docker image runs Next's self-contained server (see Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  devIndicators: false,
  // The call graph parses JS/TS with the TypeScript compiler on the server; it stays a plain Node package.
  serverExternalPackages: ["typescript"],
  // The database migrations are read at runtime on first use.
  outputFileTracingIncludes: { "/**": ["./drizzle/**"], "/guide": ["./docs/user-guide.md"] },
  // The data page used to live at /dashboard.
  async redirects() {
    return [{ source: "/dashboard", destination: "/data", permanent: true }];
  },
  // /owner/repo.md is the repo's read as Markdown (served from /owner/repo/llms.md).
  async rewrites() {
    return { beforeFiles: [{ source: "/:owner/:repo.md", destination: "/:owner/:repo/llms.md" }], afterFiles: [], fallback: [] };
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
