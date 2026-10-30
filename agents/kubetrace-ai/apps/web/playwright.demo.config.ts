import { defineConfig } from "@playwright/test";

// Demo recording: one live run, recorded as video at 1600×1000.
export default defineConfig({
  testDir: "e2e",
  testMatch: "demo-recording.spec.ts",
  timeout: 30 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "demo-output",
  use: {
    baseURL: process.env.KUBETRACE_URL ?? "http://127.0.0.1:8000",
    viewport: { width: 1600, height: 1000 },
    video: { mode: "on", size: { width: 1600, height: 1000 } },
    launchOptions: { slowMo: 150 },
  },
});
