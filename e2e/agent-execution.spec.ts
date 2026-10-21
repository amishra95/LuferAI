import { expect, test, type Page } from "@playwright/test";

import { closeStream, mockedRequests, mockStreams, sendFrames, signInAs, skipIfSignedOut, typeAndSubmit } from "./support/stream";

/*
 * /agents live run: a multi-step turn (spend policy check, then a sandboxed
 * card) shown step by step as its events stream in. The run's SSE stream is
 * scripted (lib/agents/run-events.ts), so no card is issued.
 */

signInAs("admin");

const STREAM = "/api/agents/stream";
const PROMPT = "Book the Q4 offsite at The Leela for 40 and pay by corporate card";

async function openLiveRun(page: Page) {
  const liveRun = page.getByRole("dialog", { name: "Workspace agent" }).getByRole("region", { name: "Live run" });
  // A click before hydration does nothing, so retry until the sheet opens.
  await expect(async () => {
    await page.getByRole("button", { name: "Configure Workspace agent" }).click();
    await expect(liveRun).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const prompt = liveRun.getByLabel("Prompt", { exact: true });
  await expect(prompt).toBeEnabled();
  return { liveRun, prompt };
}

test.beforeEach(async ({ page }) => {
  await mockStreams(page, [STREAM]);
  await page.goto("/agents");
  skipIfSignedOut(page);
});

test("multi-step tool calls: spend policy, then a sandboxed card", async ({ page }) => {
  const { liveRun, prompt } = await openLiveRun(page);
  await typeAndSubmit(prompt, PROMPT, liveRun.getByRole("button", { name: "Run" }));

  const progress = liveRun.getByRole("status");
  await expect(progress).toContainText("Thinking…");
  await expect(liveRun.getByRole("button", { name: "Stop" })).toBeVisible();
  const [request] = await mockedRequests(page);
  const params = new URL(request.url, page.url()).searchParams;
  expect(params.get("prompt")).toBe(PROMPT);
  expect(params.get("agent")).toBeTruthy();
  expect(params.has("model")).toBe(false);

  await sendFrames(page, STREAM, { type: "system_prompt", agent: "workspace", model: "gemini", text: "You are LuferAI." }, {
    type: "tool_call",
    step: 1,
    toolCallId: "c1",
    toolName: "checkSpendPolicy",
    input: { bookingId: "b-1", amountInr: 96000 },
  });
  await expect(progress).toContainText("Verifying department spend policy…");
  await expect(progress).toContainText("step 1");
  await expect(liveRun.getByText("checkSpendPolicy").first()).toBeVisible();

  await sendFrames(page, STREAM, { type: "tool_response", step: 1, toolCallId: "c1", toolName: "checkSpendPolicy", ok: true, output: { allowed: true, perHeadInr: 2400 } });
  await expect(progress).toContainText("Reviewing results…");

  await sendFrames(page, STREAM, { type: "tool_call", step: 2, toolCallId: "c2", toolName: "issueCorporateVirtualCard", input: { bookingId: "b-1" } });
  await expect(progress).toContainText("Issuing sandboxed virtual card…");
  await expect(progress).toContainText("step 2");

  await sendFrames(
    page,
    STREAM,
    { type: "tool_response", step: 2, toolCallId: "c2", toolName: "issueCorporateVirtualCard", ok: true, output: { card: { last4: "4242", sandbox: true, provider: "sandbox" } } },
    { type: "final_output", step: 3, text: "Policy passed and a sandbox card ending 4242 is ready." }
  );
  await expect(progress).toContainText("Writing the answer…");

  await sendFrames(page, STREAM, { type: "usage", promptTokens: 1800, completionTokens: 240, cost: 0.0012 }, { type: "done", steps: 3, durationMs: 4200 });
  await closeStream(page, STREAM);

  await expect(liveRun.getByText("Policy passed and a sandbox card ending 4242 is ready.")).toBeVisible();
  await expect(liveRun.getByText("3 steps · 4.2 s")).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(liveRun.getByRole("button", { name: "Run" })).toBeVisible();
  // Both tool calls and their responses stay in the run log, in order.
  const log = await liveRun.locator("ol li").allInnerTexts();
  const order = ["checkSpendPolicy", "checkSpendPolicy", "issueCorporateVirtualCard", "issueCorporateVirtualCard"];
  expect(log.filter((t) => /Tool (call|response)/.test(t)).map((t) => order.find((n) => t.includes(n)))).toEqual(order);
});

test("a failed tool and a run error end the run", async ({ page }) => {
  const { liveRun, prompt } = await openLiveRun(page);
  await typeAndSubmit(prompt, PROMPT, liveRun.getByRole("button", { name: "Run" }));
  await expect(liveRun.getByRole("status")).toContainText("Thinking…");

  await sendFrames(
    page,
    STREAM,
    { type: "tool_call", step: 1, toolCallId: "c1", toolName: "checkSpendPolicy", input: {} },
    { type: "tool_response", step: 1, toolCallId: "c1", toolName: "checkSpendPolicy", ok: false, output: { error: "Over the per-head cap" } },
    { type: "error", message: "Spend policy blocked this booking." }
  );
  await closeStream(page, STREAM);

  await expect(liveRun.getByText("Spend policy blocked this booking.")).toBeVisible();
  await expect(liveRun.getByRole("status")).toHaveCount(0);
  await expect(liveRun.getByRole("button", { name: "Run" })).toBeEnabled();
});
