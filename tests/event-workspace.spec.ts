import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { accessTokenFor, adminClient, authFile, eventId, missing, mutationsAllowed, MUTATIONS_OFF, runTag, supabaseAnonKey, supabaseUrl, watchConsole } from "./support/e2e";

/**
 * Two signed-in teammates (buyer = A, buyer2 = B) in one event workspace, over
 * the room's Realtime channel. Needs E2E_EVENT_ID set to a booking both can open.
 */
const skipReason = missing("buyer", "buyer2") ?? (eventId() ? null : "Set E2E_EVENT_ID to an event workspace both buyers can open");

/** Matches relativeTime() in lib/events/activity.ts: "just now", "4m ago", "3h ago", or "12 Oct". */
const RELATIVE_TIME = /^(just now|\d+m ago|\d+h ago|\d{1,2} [A-Z][a-z]{2,3})$/;

test.describe("event workspace multiplayer", () => {
  test.skip(Boolean(skipReason), skipReason ?? "");

  let ctxA: BrowserContext, ctxB: BrowserContext;
  let a: Page, b: Page;
  let problemsA: string[], problemsB: string[];
  let nameA: string, nameB: string;

  test.beforeEach(async ({ browser }) => {
    ({ ctx: ctxA, page: a, problems: problemsA } = await openRoom(browser, "buyer"));
    ({ ctx: ctxB, page: b, problems: problemsB } = await openRoom(browser, "buyer2"));
    await expect(liveStatus(a)).toHaveText(/^Live · \d+ here$/, { timeout: 20_000 });
    await expect(liveStatus(b)).toHaveText(/^Live · \d+ here$/, { timeout: 20_000 });
    nameA = await selfName(a);
    nameB = await selfName(b);
  });

  test.afterEach(async () => {
    expect(problemsA, "console: duplicate keys / hydration (A)").toEqual([]);
    expect(problemsB, "console: duplicate keys / hydration (B)").toEqual([]);
    await ctxA?.close();
    await ctxB?.close();
  });

  test("each teammate sees the other in the presence stack", async () => {
    await expect(avatar(a, nameB)).toBeVisible();
    await expect(avatar(b, nameA)).toBeVisible();
    // Fades in, rather than popping.
    await expect(avatar(b, nameA)).toHaveClass(/animate-in fade-in/);
  });

  test("a remote cursor follows the pointer, then fades after 3 s idle", async () => {
    const canvas = overlay(a).locator("..");
    const box = (await canvas.boundingBox())!;
    // Several moves, spaced past the 50 ms broadcast throttle.
    for (const f of [0.2, 0.3, 0.4]) {
      await a.mouse.move(box.x + box.width * f, box.y + Math.min(box.height * f, 400), { steps: 3 });
      await a.waitForTimeout(120);
    }
    const stoppedAt = Date.now();

    const cursor = overlay(b).locator(":scope > div").filter({ hasText: nameA });
    await expect(cursor).toBeVisible();
    await expect(cursor).toHaveCSS("opacity", "1");
    const left = await cursor.evaluate((el) => (el as HTMLElement).style.left);
    expect(parseFloat(left)).toBeGreaterThan(0);

    // Still solid just under the idle window…
    await b.waitForTimeout(Math.max(0, 2_000 - (Date.now() - stoppedAt)));
    await expect(cursor).toHaveCSS("opacity", "1");
    // …then fades (the room re-checks every 2 s, so allow up to ~6 s).
    await expect.poll(() => cursor.evaluate((el) => getComputedStyle(el).opacity), { timeout: 8_000, intervals: [250] }).toBe("0");
    expect(Date.now() - stoppedAt).toBeGreaterThanOrEqual(3_000);
  });

  test("more than 5 people collapse into a +N pill", async () => {
    // Whoever else has the room open counts too.
    await expect(liveStatus(a)).not.toHaveText("Live · 1 here");
    const before = Number(/(\d+) here/.exec((await liveStatus(a).textContent()) ?? "")![1]);
    // Five extra presences on the room's channel, joined as B from Node.
    const ghosts = await joinGhosts(5);
    try {
      await expect(liveStatus(a)).toHaveText(`Live · ${before + 5} here`, { timeout: 15_000 });
      const stack = a.getByRole("list", { name: "People in this workspace" });
      const pill = stack.getByRole("listitem").filter({ hasText: new RegExp(`^\\+${before}$`) });
      await expect(pill).toBeVisible();
      await expect(pill).toHaveAttribute("title", /E2E Ghost/);
      await expect(stack.locator("li:not([aria-hidden])").filter({ hasNotText: /^\+\d+$/ })).toHaveCount(5);
    } finally {
      await ghosts.leave();
    }
    await expect(liveStatus(a)).toHaveText(`Live · ${before} here`, { timeout: 15_000 });
    if (before <= 5) await expect(a.getByRole("list", { name: "People in this workspace" }).getByRole("listitem").filter({ hasText: /^\+\d+$/ })).toHaveCount(0);
  });

  test("activity feed streams edits and RSVPs live, with relative times", async ({ browser }) => {
    test.skip(!mutationsAllowed(), MUTATIONS_OFF);
    const tag = runTag();
    const guest = { name: `E2E Guest ${tag}`, email: `${tag}@example.com` };

    try {
      // A edits the workspace: adds a guest.
      await a.getByLabel("Add guests, one per line").fill(`${guest.name} <${guest.email}>`);
      await a.getByRole("button", { name: "Add", exact: true }).click();

      const feedB = b.getByRole("list", { name: "Recent activity" });
      const added = feedB.getByRole("listitem").filter({ hasText: `${nameA} added a guest` }).first();
      await expect(added).toBeVisible({ timeout: 15_000 });
      await expect(added.locator("time")).toHaveText("just now");

      // The guest replies from their personal link, signed out.
      const { data: row, error } = await adminClient().from("event_attendees").select("rsvp_token").eq("booking_id", eventId()).eq("email", guest.email).single();
      expect(error, "fetch the new guest's RSVP token").toBeNull();
      const guestCtx = await browser.newContext();
      const rsvp = await guestCtx.newPage();
      await rsvp.goto(`/rsvp/${row!.rsvp_token}`);
      await rsvp.getByText("Going", { exact: true }).click();
      await rsvp.getByRole("button", { name: "Send reply" }).click();
      await expect(rsvp.getByRole("status")).toContainText("your reply is saved: going");
      await guestCtx.close();

      const replied = feedB.getByRole("listitem").filter({ hasText: `${guest.name} replied going` });
      await expect(replied).toHaveCount(1, { timeout: 15_000 });
      await expect(replied.locator("time")).toHaveText("just now");
      // A sees the guest's reply too.
      await expect(a.getByRole("list", { name: "Recent activity" }).getByRole("listitem").filter({ hasText: `${guest.name} replied going` })).toHaveCount(1, { timeout: 15_000 });

      // Every entry: a valid machine time and a relative label; no entry twice.
      for (const feed of [feedB, a.getByRole("list", { name: "Recent activity" })]) {
        const items = await feed.getByRole("listitem").evaluateAll((lis) =>
          lis.map((li) => ({ text: li.textContent ?? "", at: li.querySelector("time")?.getAttribute("datetime") ?? "", label: li.querySelector("time")?.textContent ?? "" }))
        );
        for (const item of items) {
          expect(Number.isNaN(Date.parse(item.at)), `datetime of "${item.text}"`).toBe(false);
          expect(item.label, `relative time of "${item.text}"`).toMatch(RELATIVE_TIME);
        }
        const keys = items.map((i) => `${i.at}|${i.text}`);
        expect(new Set(keys).size, "duplicate feed entries").toBe(keys.length);
      }
    } finally {
      await adminClient().from("event_attendees").delete().eq("booking_id", eventId()).eq("email", guest.email);
    }
  });

  async function openRoom(browser: Browser, role: "buyer" | "buyer2") {
    const ctx = await browser.newContext({ storageState: authFile(role) });
    const page = await ctx.newPage();
    const problems = watchConsole(page);
    await page.goto(`/client/events/${eventId()}`);
    return { ctx, page, problems };
  }

  /** B's session, five times over, with made-up presence keys. */
  async function joinGhosts(n: number) {
    const token = await accessTokenFor("buyer2");
    const joined: { client: SupabaseClient; channel: RealtimeChannel }[] = [];
    for (let i = 1; i <= n; i++) {
      const userId = `e2e-ghost-${i}`;
      const client = createClient(supabaseUrl(), supabaseAnonKey(), { accessToken: async () => token });
      await client.realtime.setAuth(token);
      const channel = client.channel(`event:${eventId()}`, { config: { private: true, presence: { key: userId }, broadcast: { self: false } } });
      await new Promise<void>((resolve, reject) =>
        channel.subscribe((status, err) => {
          if (status === "SUBSCRIBED") resolve();
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`ghost ${i}: ${status} ${err?.message ?? ""}`));
        })
      );
      await channel.track({ userId, name: `E2E Ghost ${i}`, joinedAt: new Date(Date.now() + i).toISOString(), section: null });
      joined.push({ client, channel });
    }
    return {
      leave: async () => {
        await Promise.all(joined.map(({ client, channel }) => client.removeChannel(channel)));
      },
    };
  }
});

const liveStatus = (page: Page) => page.getByText(/^(Live · \d+ here|Connecting…|Offline · changes still save)$/);
const overlay = (page: Page) => page.locator("div.pointer-events-none.absolute.inset-0.overflow-hidden");
const avatar = (page: Page, name: string) => page.getByRole("list", { name: "People in this workspace" }).getByRole("listitem").filter({ has: page.locator(".sr-only", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });

/** The signed-in user's display name, from their own avatar ("Name (you)"). */
async function selfName(page: Page): Promise<string> {
  const own = page.getByRole("list", { name: "People in this workspace" }).locator(".sr-only", { hasText: "(you)" });
  await expect(own).toHaveCount(1);
  return ((await own.textContent()) ?? "").replace(/\s*\(you\)\s*$/, "").trim();
}
