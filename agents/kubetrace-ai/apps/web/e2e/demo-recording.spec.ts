import { expect, test } from "@playwright/test";

// Records the flagship demo as a video: a LIVE run (real model on Nebius Token Factory) of the
// application-bug scenario. Run with: npx playwright test --config playwright.demo.config.ts
// The model shown is whatever the server's NEBIUS_MODEL is; the header badge displays it.
const hold = (page: any, ms: number) => page.waitForTimeout(ms);

test("demo: Beam fixes a checkout bug end to end", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("header-status")).toContainText("Token Factory");
  await expect(page.getByTestId("topology")).toBeVisible();
  await hold(page, 5000);

  await page.goto("/experiments");
  const card = page.getByTestId("experiment-application-bug");
  const live = page.locator("#live");
  if ((await live.getAttribute("data-state")) !== "checked") await live.click();
  await expect(page.getByText("Live model")).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await hold(page, 3000);

  await page.getByTestId("setup-application-bug").click();
  await expect(card.getByTestId("state-badge")).toHaveText(/Baseline healthy/, { timeout: 8 * 60_000 });
  await hold(page, 2000);

  // The healthy cluster before the fault.
  await page.goto("/");
  await hold(page, 6000);
  await page.goto("/experiments");
  await page.getByTestId("inject-application-bug").click();
  await expect(page.getByTestId("experiment-application-bug").getByTestId("state-badge")).toHaveText(/Detected/, { timeout: 5 * 60_000 });
  await hold(page, 2500);

  await page.getByTestId("investigate-application-bug").click();
  await expect(page).toHaveURL(/\/runs\/[\w-]+$/);
  await expect(page.getByTestId("provenance")).toHaveText(/Live/);
  const outcome = page.getByTestId("state-stepper");
  // Let the live run play out on screen; the timeline auto-scrolls.
  await expect(outcome).toContainText(/Resolved|Unresolved|Blocked|Escalated|Cancelled/, { timeout: 15 * 60_000 });
  await hold(page, 4000);

  for (const tab of ["Patch", "Tests", "Verification", "Evidence"]) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await hold(page, 5000);
  }

  await page.getByRole("link", { name: "Report" }).click();
  await expect(page.getByTestId("report")).toBeVisible();
  await page.locator("#pres").click();
  await hold(page, 3000);
  for (let y = 0; y < 5; y++) {
    await page.mouse.wheel(0, 700);
    await hold(page, 2500);
  }
});
