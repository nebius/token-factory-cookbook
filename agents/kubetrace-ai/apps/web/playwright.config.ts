import { defineConfig, devices } from "@playwright/test";

// Drives the real UI served by the running API (uv run kubetrace serve) against a kind cluster.
export default defineConfig({
  testDir: "e2e",
  testIgnore: "demo-recording.spec.ts",
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.KUBETRACE_URL ?? "http://127.0.0.1:8000", viewport: { width: 1600, height: 1000 },
         trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } } }],
});
