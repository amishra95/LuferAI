import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { sessionFile } from "./support/stream";

/*
 * Live acceptance, across two signed-in browsers:
 *   1. an Organizer files an in-policy manual request for Mosaic Kitchen & Bar,
 *   2. Mosaic's property manager accepts it in /property,
 *   3. the Organizer's /client, never reloaded, shows the "confirmed your
 *      booking!" toast and the green "Accepted by venue" badge.
 *
 * This creates and confirms a real booking in whatever database the target
 * app uses, so it runs only when asked: E2E_ALLOW_WRITES=1, plus saved
 * sessions for an Organizer (buyer.json) and Mosaic's property manager
 * (property.json), which e2e/auth.setup.ts saves from ORGANIZER_EMAIL and
 * PROPERTY_MANAGER_EMAIL. Point it at a staging project, not production.
 * Chromium only, so one run makes one booking.
 */

const VENUE = "Mosaic Kitchen & Bar";
const writes = process.env.E2E_ALLOW_WRITES === "1";
const sessions = { organizer: sessionFile("buyer"), property: sessionFile("property") };

test.skip(!writes, "Creates and confirms a real booking: set E2E_ALLOW_WRITES=1 (against staging)");

/** A date 100–160 days out, so it's free and unlikely to clash with an earlier run's hold. */
function eventDate(): string {
  const d = new Date(Date.now() + (100 + Math.floor(Math.random() * 60)) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function signedIn(page: Page, path: string) {
  await page.goto(path);
  test.skip(new URL(page.url()).pathname === "/login", `Saved session for ${path} expired: sign in again and re-save it`);
}

test("a venue's acceptance reaches the organizer's portal live", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "One booking per run");
  // Checked when the test runs, not when files load: the setup project may have just saved them.
  test.skip(!existsSync(sessions.organizer) || !existsSync(sessions.property), `Needs saved sessions at ${sessions.organizer} and ${sessions.property} (run with PROPERTY_MANAGER_EMAIL / ORGANIZER_EMAIL set)`);
  test.setTimeout(150_000);
  const marker = `E2E live acceptance ${Date.now()}`;

  const organizer = await (await browser.newContext({ storageState: sessions.organizer })).newPage();
  const property = await (await browser.newContext({ storageState: sessions.property })).newPage();

  // 1. The organizer files an in-policy request by hand: 40 guests at ₹2,500/head.
  await signedIn(organizer, "/client");
  await organizer.evaluate(() => ((window as unknown as { __notReloaded: boolean }).__notReloaded = true));
  await organizer.getByRole("button", { name: "New manual RFP" }).click();
  const dialog = organizer.getByRole("dialog", { name: /Book manually/ });
  await dialog.getByLabel("Search venues").fill("Mosaic");
  await dialog.getByRole("radio", { name: new RegExp(VENUE) }).check();
  await dialog.getByLabel("Event date").fill(eventDate());
  await dialog.getByLabel("Guests", { exact: true }).fill("40");
  await dialog.getByLabel("Budget / head (₹)").fill("2500");
  await dialog.getByRole("button", { name: /Next: Billing/ }).click();
  await dialog.getByLabel("Cost centre").fill("E2E-LIVE");
  await dialog.getByLabel(/Notes for the venue/).fill(marker);
  await dialog.getByRole("button", { name: /Next: Review/ }).click();
  await dialog.getByRole("button", { name: "Submit direct RFP" }).click();
  // In policy, so it goes straight to the venue (no sign-off).
  await expect(dialog.getByText(`Request sent to ${VENUE}`)).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Close" }).click();

  // 2. Mosaic's manager accepts it from the inbound requests.
  await signedIn(property, "/property");
  const request = property.getByRole("listitem").filter({ hasText: marker });
  await expect(request).toBeVisible({ timeout: 30_000 });
  await request.getByRole("button", { name: "Accept request" }).click();
  await expect(request).toBeHidden({ timeout: 30_000 });

  // 3. The organizer's portal catches it live: toast and badge, no reload.
  await expect(organizer.getByText(`${VENUE} confirmed your booking!`)).toBeVisible({ timeout: 45_000 });
  await expect(organizer.getByText("Accepted by venue").first()).toBeVisible();
  expect(await organizer.evaluate(() => (window as unknown as { __notReloaded?: boolean }).__notReloaded)).toBe(true);
});
