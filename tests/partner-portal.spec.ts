import { expect, test, type Locator, type Page } from "@playwright/test";

import { authFile, missing, mutationsAllowed, MUTATIONS_OFF } from "./support/e2e";

const LANES = ["To confirm", "To ship", "To deliver", "Delivered"] as const;

test.describe("signed out", () => {
  test("/partner sends visitors to login", async ({ page }) => {
    await page.goto("/partner");
    await expect(page).toHaveURL(/\/login\?/);
  });
});

test.describe("partner orders board", () => {
  test.skip(Boolean(missing("partner")), missing("partner") ?? "");
  test.use({ storageState: authFile("partner") });

  test.beforeEach(async ({ page }) => {
    await page.goto("/partner?tab=orders");
    test.skip(await page.getByText("No orders yet").isVisible(), "The partner has no orders");
  });

  test("has four lanes in order and a collapsed cancelled list", async ({ page }) => {
    const lanes = board(page).locator(":scope > section");
    await expect(lanes).toHaveCount(4);
    for (const [i, title] of LANES.entries()) {
      await expect(lanes.nth(i)).toHaveAttribute("aria-label", new RegExp(`^${title}: \\d+$`));
      await expect(lanes.nth(i).getByRole("heading", { level: 3 })).toContainText(title);
    }

    const cancelled = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Cancelled · \d+$/ }) });
    if ((await cancelled.count()) === 0) {
      test.info().annotations.push({ type: "note", description: "No cancelled orders: the collapsed section isn't rendered" });
      return;
    }
    // Collapsed by default; opens on click and lists exactly N orders.
    await expect(cancelled).not.toHaveAttribute("open", /.*/);
    await expect(cancelled.locator("li").first()).toBeHidden();
    const n = Number(/(\d+)$/.exec((await cancelled.locator("summary").textContent()) ?? "")![1]);
    await cancelled.locator("summary").click();
    await expect(cancelled).toHaveAttribute("open", "");
    await expect(cancelled.locator(":scope > ul > li")).toHaveCount(n);
    // Cancelled cards can't be dragged.
    await expect(cancelled.locator('li[draggable="true"]')).toHaveCount(0);
  });

  test("dragging a card lights up only the lanes it may move to", async ({ page }) => {
    const card = board(page).locator('li[draggable="true"]').first();
    test.skip((await card.count()) === 0, "No order the partner can move");
    const source = card.locator("xpath=ancestor::section[1]");
    const sourceLabel = await source.getAttribute("aria-label");

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer });

    const lanes = board(page).locator(":scope > section");
    const droppable = board(page).locator(":scope > section.border-dashed");
    await expect.poll(() => droppable.count(), { message: "some lane accepts the card" }).toBeGreaterThan(0);

    for (let i = 0; i < 4; i++) {
      const lane = lanes.nth(i);
      const label = await lane.getAttribute("aria-label");
      const cls = (await lane.getAttribute("class")) ?? "";
      if (label === sourceLabel) {
        expect(cls, `source lane ${label}`).not.toMatch(/border-dashed|opacity-50/);
      } else if (!cls.includes("border-dashed")) {
        expect(cls, `lane ${label} can't take the card, so it dims`).toMatch(/opacity-50/);
      }
    }

    // Hovering a droppable lane highlights it; leaving clears it.
    const target = droppable.first();
    await target.dispatchEvent("dragover", { dataTransfer });
    await expect(target).toHaveClass(/bg-surface-hover/);
    await expect(target).toHaveClass(/border-fg-subtle/);
    await card.dispatchEvent("dragend", { dataTransfer });
    await expect(board(page).locator(":scope > section.border-dashed")).toHaveCount(0);
    await expect(board(page).locator(":scope > section.bg-surface-hover")).toHaveCount(0);
  });

  test("dropping a new order on its next lane confirms it", async ({ page }) => {
    test.skip(!mutationsAllowed(), MUTATIONS_OFF);
    // Confirming captures the buyer's payment, so only ever move a named test order.
    const orderId = process.env.E2E_ORDER_ID?.trim();
    test.skip(!orderId, "Set E2E_ORDER_ID to a PLACED test order (confirming it captures payment)");

    const toConfirm = lane(page, "To confirm");
    const subject = toConfirm.locator(`li[data-order-id="${orderId}"][draggable="true"]`);
    await expect(subject, `order ${orderId} should be in To confirm and movable`).toHaveCount(1);
    const counts = await laneCounts(page);

    // Real pointer drag (HTML5 drag and drop in Chromium).
    const target = (await lane(page, "To ship").count()) && (await canTake(page, subject, "To ship")) ? "To ship" : "To deliver";
    await subject.dragTo(lane(page, target));

    const moved = lane(page, target).locator(`li[data-order-id="${orderId}"]`);
    await expect(moved).toBeVisible();
    await expect(moved.locator(".pill").last()).toHaveText("Confirmed");
    await expect(page.getByText(/: confirmed$/)).toBeVisible();
    const after = await laneCounts(page);
    expect(after["To confirm"]).toBe(counts["To confirm"] - 1);
    expect(after[target]).toBe(counts[target] + 1);
  });
});

const board = (page: Page) => page.getByRole("list", { name: "Fulfilment board" });
const lane = (page: Page, title: (typeof LANES)[number]) => board(page).locator(`:scope > section[aria-label^="${title}:"]`);

async function laneCounts(page: Page): Promise<Record<(typeof LANES)[number], number>> {
  const out = {} as Record<(typeof LANES)[number], number>;
  for (const title of LANES) out[title] = Number(/: (\d+)$/.exec((await lane(page, title).getAttribute("aria-label")) ?? "")![1]);
  return out;
}

/** Whether `title` lights up as a drop target for `card` (goods go to "To ship", services to "To deliver"). */
async function canTake(page: Page, card: Locator, title: (typeof LANES)[number]): Promise<boolean> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent("dragstart", { dataTransfer });
  await expect.poll(async () => board(page).locator(":scope > section.border-dashed").count()).toBeGreaterThan(0);
  const ok = /border-dashed/.test((await lane(page, title).getAttribute("class")) ?? "");
  await card.dispatchEvent("dragend", { dataTransfer });
  return ok;
}
