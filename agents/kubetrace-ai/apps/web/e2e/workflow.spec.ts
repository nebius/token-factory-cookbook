import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Full workflow in fixture mode (no model is called): setup → inject → investigate → resolved → report → export.
test("selector mismatch: from fault injection to an exported report", async ({ page }) => {
  await page.goto("/experiments");
  const card = page.getByTestId("experiment-selector-mismatch");
  await expect(card).toBeVisible();

  const live = page.locator("#live");
  if ((await live.getAttribute("data-state")) === "checked") await live.click();
  await expect(page.getByText("Fixture (scripted, no model)")).toBeVisible();

  await page.getByTestId("setup-selector-mismatch").click();
  await expect(card.getByTestId("state-badge")).toHaveText(/Baseline healthy/, { timeout: 8 * 60_000 });

  await page.getByTestId("inject-selector-mismatch").click();
  await expect(card.getByTestId("state-badge")).toHaveText(/Detected/, { timeout: 3 * 60_000 });

  await page.getByTestId("investigate-selector-mismatch").click();
  await expect(page).toHaveURL(/\/runs\/[\w-]+$/);
  await expect(page.getByTestId("provenance")).toHaveText(/FIXTURE/);
  await expect(page.getByTestId("timeline")).toContainText("Detected: Storefront checkout is down");
  await expect(page.getByTestId("state-stepper")).toContainText("Resolved", { timeout: 5 * 60_000 });
  await expect(page.getByTestId("timeline")).toContainText("Independent verification passed");
  await expect(page.getByTestId("timeline")).toContainText("apply_manifest");

  await page.getByRole("link", { name: "Report" }).click();
  const report = page.getByTestId("report");
  await expect(report).toContainText("Run report · selector-mismatch");
  await expect(report).toContainText("This is a FIXTURE run");
  await expect(report).toContainText("selector matches the storefront Pods");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown" }).click();
  const file = await (await download).path();
  const md = readFileSync(file!, "utf8");
  expect(md).toContain("FIXTURE run");
  expect(md).toContain("## Independent verification");
});
