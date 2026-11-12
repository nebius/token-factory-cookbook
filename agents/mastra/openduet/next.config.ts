import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Keep the dev badge clear of the sidebar's bottom bar.
  devIndicators: { position: "bottom-right" },
  // Mastra and its runtimes (LibSQL, QuickJS, agent-browser) use Node-only
  // features, so they load with plain Node `require` instead of being bundled.
  serverExternalPackages: [
    "@mastra/core",
    "@mastra/memory",
    "@mastra/libsql",
    "@mastra/tavily",
    "@mastra/quickjs",
    "@mastra/agent-browser",
    "@libsql/client",
    "@tavily/core",
    "agent-browser",
    "quickjs-emscripten",
  ],
};

export default nextConfig;
