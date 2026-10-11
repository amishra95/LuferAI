import { expect, test, type Locator, type Page } from "@playwright/test";

import { authFile, missing, mutationsAllowed, MUTATIONS_OFF } from "./support/e2e";

const NO_MODEL = "The concierge needs an AI model configured (see Settings).";
const AGENT_OFF = "The concierge is switched off on the Agents page.";

test.describe("signed out", () => {
  test("/client sends visitors to login", async ({ page }) => {
    await page.goto("/client");
    await expect(page).toHaveURL(/\/login\?/);
  });
});

test.describe("concierge panel", () => {
  test.skip(Boolean(missing("buyer")), missing("buyer") ?? "");
  test.use({ storageState: authFile("buyer") });

  const panel = (page: Page) => page.getByRole("region", { name: "Ask the concierge" });

  test("renders above the booking tools, with prompts or a clear fallback", async ({ page }) => {
    await page.goto("/client");
    const concierge = panel(page);
    await expect(concierge).toBeVisible();
    await expect(concierge.getByRole("heading", { name: "Ask the concierge" })).toBeVisible();
    // First block of the booking tools column, so it sits above them.
    expect(await concierge.evaluate((el) => el.parentElement?.firstElementChild === el)).toBe(true);

    const input = concierge.getByLabel("Describe your event");
    const fallback = concierge.getByRole("status");
    if (process.env.E2E_SIMULATE_NO_MODEL === "1" || (await fallback.isVisible())) {
      await expect(fallback).toHaveText(process.env.E2E_SIMULATE_NO_MODEL === "1" ? NO_MODEL : new RegExp(`^(${escape(NO_MODEL)}|${escape(AGENT_OFF)})$`));
      await expect(concierge.getByRole("list", { name: "Try asking" })).toHaveCount(0);
      await expect(input).toBeDisabled();
      await expect(input).toHaveAttribute("placeholder", "Unavailable");
      await expect(concierge.getByRole("button", { name: "Send" })).toBeDisabled();
    } else {
      const prompts = concierge.getByRole("list", { name: "Try asking" }).getByRole("button");
      await expect(prompts).toHaveCount(3);
      await expect(prompts.first()).toContainText("Team dinner for 40");
      await expect(input).toBeEnabled();
      // Send stays disabled until there's a draft.
      await expect(concierge.getByRole("button", { name: "Send" })).toBeDisabled();
      await input.fill("Offsite for 30");
      await expect(concierge.getByRole("button", { name: "Send" })).toBeEnabled();
    }
  });

  test("shows the agent-off fallback when the workspace agent is switched off", async ({ page, browser }) => {
    test.skip(Boolean(missing("admin")), missing("admin") ?? "");
    test.skip(!mutationsAllowed(), MUTATIONS_OFF);

    await page.goto("/client");
    const fallback = panel(page).getByRole("status");
    test.skip((await fallback.count()) > 0 && (await fallback.textContent()) === NO_MODEL,"No AI model configured: that message takes precedence over the agent switch");

    const adminCtx = await browser.newContext({ storageState: authFile("admin") });
    const admin = await adminCtx.newPage();
    await admin.goto("/agents");
    const toggle = admin.getByRole("switch", { name: /Workspace agent$/ });
    const wasOn = (await toggle.getAttribute("aria-checked")) === "true";
    try {
      if (wasOn) await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");

      await page.reload();
      await expect(fallback).toHaveText(AGENT_OFF);
      await expect(panel(page).getByLabel("Describe your event")).toBeDisabled();
    } finally {
      // The agent store is per server process; put it back for the next run.
      if (wasOn && (await toggle.getAttribute("aria-checked")) === "false") {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", "true");
      }
      await adminCtx.close();
    }
  });
});

test.describe("blanket PO budget meters", () => {
  test.skip(Boolean(missing("buyer")), missing("buyer") ?? "");
  test.use({ storageState: authFile("buyer") });

  test("segments and threshold states match each open PO's balance", async ({ page }) => {
    await page.goto("/client?tab=pos");
    const overview = page.getByRole("region", { name: "Budget overview" });
    test.skip((await overview.count()) === 0, "The buyer's company has no open POs");

    const rows = overview.getByRole("listitem");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    const seen = new Set<Tone>();

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const meter = row.getByRole("meter");
      const { pct, tone } = await readMeter(meter);
      seen.add(tone);
      const poNumber = (await row.getByRole("link").textContent())?.trim();
      const what = `${poNumber} at ${pct}%`;

      await expectSegments(meter, what);
      await expect(meter, what).toHaveAttribute("aria-valuenow", String(Math.min(100, pct)));

      // Bar colour: red over 100%, amber from 90%, neutral below.
      const fill = meter.locator("span").first();
      if (tone === "over") {
        await expect(fill, what).toHaveClass(/(^|\s)bg-rose(\s|$)/);
        await expect(meter, what).toHaveClass(/border-rose\/40/);
      } else if (tone === "critical") {
        await expect(fill, what).toHaveClass(/(^|\s)bg-warn(\s|$)/);
      } else {
        await expect(fill, what).toHaveClass(/(^|\s)bg-fg(\s|$)/);
      }

      // Text warning: amber from 75%, red when over, plain below.
      const figure = row.locator("span").last();
      if (tone === "over") await expect(figure, what).toHaveClass(/text-rose/);
      else if (tone === "ok") await expect(figure, what).toHaveClass(/text-fg-subtle/);
      else await expect(figure, what).toHaveClass(/text-warn/);

      // The PO's own panel says it in words, in its legend.
      const href = await row.getByRole("link").getAttribute("href");
      const poPanel = page.locator(href!);
      const legend = { ok: null, watch: "watch", critical: "nearly drawn", over: "overrun" }[tone];
      for (const word of ["watch", "nearly drawn", "overrun"]) {
        await expect(poPanel.getByText(word, { exact: true }), what).toHaveCount(word === legend ? 1 : 0);
      }
    }

    const atRisk = [...seen].filter((t) => t !== "ok").length;
    if (atRisk) await expect(overview.getByText(/need attention$/)).toBeVisible();
    // Which thresholds this data exercised; seed POs at ~50/80/95/110% to cover all four.
    test.info().annotations.push({ type: "budget tones covered", description: [...seen].sort().join(", ") });
  });
});

type Tone = "ok" | "watch" | "critical" | "over";

/** Mirrors budgetTone() in lib/procurement/po-ledger.ts, from the meter's own label. */
async function readMeter(meter: Locator): Promise<{ pct: number; tone: Tone }> {
  const label = (await meter.getAttribute("aria-label")) ?? "";
  const match = /^(-?\d+)% drawn: /.exec(label);
  expect(match, `meter label "${label}"`).not.toBeNull();
  const pct = Number(match![1]);
  // The label rounds; an overrun of under 0.5% reads "100%" but is still red.
  const tone: Tone = pct > 100 || (pct === 100 && /bg-rose/.test((await meter.locator("span").first().getAttribute("class")) ?? "")) ? "over" : pct >= 90 ? "critical" : pct >= 75 ? "watch" : "ok";
  return { pct, tone };
}

/** Consumed then committed, starting where consumed ends, never past 100%. */
async function expectSegments(meter: Locator, what: string) {
  const [consumed, committed] = await meter.locator("span").evaluateAll((spans) =>
    spans.slice(0, 2).map((s) => ({ left: parseFloat((s as HTMLElement).style.left || "0"), width: parseFloat((s as HTMLElement).style.width) }))
  );
  expect(consumed.width, `${what}: consumed segment`).toBeGreaterThanOrEqual(0);
  expect(committed.left, `${what}: committed starts after consumed`).toBeCloseTo(consumed.width, 1);
  expect(consumed.width + committed.width, `${what}: segments fit the bar`).toBeLessThanOrEqual(100.01);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
