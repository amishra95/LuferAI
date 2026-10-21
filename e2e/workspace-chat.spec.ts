import { expect, test } from "@playwright/test";

import { closeStream, mockedRequests, mockStreams, sendFrames, signInAs, skipIfSignedOut, typeAndSubmit } from "./support/stream";

/*
 * /chat: the user's message renders before the server answers, the progress
 * pill follows the streamed parts, tool pills turn into done badges, and the
 * turn completes. The stream is scripted (AI SDK UI message chunks).
 */

signInAs("buyer");

const CHAT = "/api/chat";
const PROMPT = "Find a venue for 40 people with a private dining room";
const ANSWER = "I found no venues matching 40 guests with a private dining room. Try widening the area.";

test.beforeEach(async ({ page }) => {
  await mockStreams(page, [CHAT]);
  await page.goto("/chat");
  skipIfSignedOut(page);
});

test("optimistic message, live progress and streamed completion", async ({ page }) => {
  const input = page.getByPlaceholder("Ask about venues, bookings, spend or budgets…");
  const progress = page.getByRole("status").filter({ hasText: "…" });

  await typeAndSubmit(input, PROMPT, page.getByRole("button", { name: "Send message" }));

  // Optimistic: the message and a "Thinking" pill show before any byte of the answer.
  await expect(page.getByText(PROMPT, { exact: true })).toBeVisible();
  await expect(progress).toContainText("Thinking…");
  await expect(input).toHaveValue("");
  const [request] = await mockedRequests(page);
  expect(request.path).toBe(CHAT);
  const body = JSON.parse(request.body ?? "{}");
  expect(JSON.stringify(body.messages)).toContain(PROMPT);
  // The server picks the model; the client never sends one.
  expect(body).not.toHaveProperty("model");

  const rowHeight = async () => (await progress.boundingBox())?.height;
  const initialHeight = await rowHeight();

  // Step 1: a venue search runs.
  await sendFrames(page, CHAT, { type: "start", messageId: "msg-e2e" }, { type: "start-step" }, { type: "tool-input-start", toolCallId: "call-1", toolName: "searchVenues" }, {
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "searchVenues",
    input: { partySize: 40, privateDining: true },
  });
  await expect(progress).toContainText("Searching venue availability…");
  await expect(progress).toContainText("step 1");
  const toolPill = page.getByRole("button", { name: /Searching venue availability…/ });
  await expect(toolPill).toBeVisible();

  // The search returns: the pill becomes a done badge.
  await sendFrames(page, CHAT, { type: "tool-output-available", toolCallId: "call-1", output: { venues: [], total: 0 } }, { type: "finish-step" });
  const donePill = page.getByRole("button", { name: /Searched venue availability/ });
  await expect(donePill).toBeVisible();
  await expect(donePill.getByLabel("done")).toBeVisible();
  await expect(progress).toContainText("Reviewing results…");

  // Step 2: the answer streams in.
  await sendFrames(page, CHAT, { type: "start-step" }, { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: ANSWER.slice(0, 40) });
  await expect(progress).toContainText("Writing the answer…");
  await expect(progress).toContainText("step 2");
  await expect(page.getByText(ANSWER.slice(0, 40))).toBeVisible();

  // The pill row never changes height between states (no layout shift).
  expect(await rowHeight()).toBe(initialHeight);

  await sendFrames(page, CHAT, { type: "text-delta", id: "t1", delta: ANSWER.slice(40) }, { type: "text-end", id: "t1" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" }, "[DONE]");
  await closeStream(page, CHAT);

  await expect(page.getByText(ANSWER)).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  await expect(donePill).toBeVisible();
});

test("a stream error ends the turn and the input works again", async ({ page }) => {
  const input = page.getByPlaceholder("Ask about venues, bookings, spend or budgets…");
  await typeAndSubmit(input, "How much have we spent this financial year?", page.getByRole("button", { name: "Send message" }));
  await expect(page.getByRole("status").filter({ hasText: "Thinking…" })).toBeVisible();

  await sendFrames(page, CHAT, { type: "start" }, { type: "error", errorText: "The model is unavailable right now." });
  await closeStream(page, CHAT);

  await expect(page.getByText("The model is unavailable right now.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Thinking…" })).toHaveCount(0);
  await input.fill("Try again");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
});
