import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Native SQLite binding stays a plain Node package.
  serverExternalPackages: ["better-sqlite3", "esbuild"],
  // Migrations and seed teardowns are read at runtime on first DB open.
  outputFileTracingIncludes: { "/**": ["./db/migrations/**", "./seed/**"] },
};

export default nextConfig;
