import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPatchFromForm, DEFAULT_BACKEND, takesTemperature, validateAgentPatch } from "../lib/agents/config.ts";
import { clipPayload, createRunEventMapper, encodeRunEvent, MAX_PAYLOAD_CHARS, parseSseFrames } from "../lib/agents/run-events.ts";
import { formatTokens, formatUsd, istDay, summarizeSpend } from "../lib/agents/spend.ts";
import { costOf } from "../lib/ai/pricing.ts";

// --- pricing ----------------------------------------------------------------

test("costOf prices calls per million tokens and rounds to 6 decimals", () => {
  assert.equal(costOf("gpt-4o", 1_000_000, 0), 2.5);
  assert.equal(costOf("gpt-4o", 0, 1_000_000), 10);
  assert.equal(costOf("claude-sonnet-5-5", 1200, 300), 0.0054); // 1200×2 + 300×10 per 1M
  assert.equal(costOf("gpt-4o", 1, 1), 0.000013); // 0.0000125 rounds to 6 dp
});

test("costOf returns null for an unlisted model and ignores negative counts", () => {
  assert.equal(costOf("gpt-4o-mini", 100, 100), null);
  assert.equal(costOf("gemini-3.8-flash", 1_000_000, 1_000_000), 4.5);
  assert.equal(costOf("gemini-3.1-flash-lite", 1_000_000, 1_000_000), 1.75);
  assert.equal(costOf("gemini-2.0-flash", 1_000_000, 1_000_000), 0.5);
  assert.equal(costOf("gemini-1.5-flash", 1_000_000, 1_000_000), 0.375);
  assert.equal(costOf("gpt-4o", -50, 0), 0);
});

// --- agent config: model backend ---------------------------------------------

test("validateAgentPatch accepts the two backends and rejects anything else", () => {
  assert.deepEqual(validateAgentPatch("workspace-agent", { model: "claude-sonnet-5-5" }), { ok: true, patch: { model: "claude-sonnet-5-5" } });
  assert.deepEqual(validateAgentPatch("workspace-agent", { model: "gpt-4o" }), { ok: true, patch: { model: "gpt-4o" } });
  assert.equal(validateAgentPatch("workspace-agent", { model: "claude-3-5-sonnet" }).ok, false);
  assert.equal(validateAgentPatch("workspace-agent", { model: 4 }).ok, false);
});

test("agentPatchFromForm carries the model through with the other fields", () => {
  const r = agentPatchFromForm("venue-sourcer", { tools: ["searchVenues"], temperature: "", maxSteps: "3", model: "claude-sonnet-5-5" });
  assert.deepEqual(r, { ok: true, patch: { tools: ["searchVenues"], temperature: null, maxSteps: 3, model: "claude-sonnet-5-5" } });
});

test("Gemini and gpt-4o take a custom temperature; Claude runs at its default", () => {
  assert.equal(takesTemperature("gemini-3.8-flash"), true);
  assert.equal(takesTemperature("gpt-4o"), true);
  assert.equal(takesTemperature("claude-sonnet-5-5"), false);
});

test("agents default to Gemini", () => {
  assert.equal(DEFAULT_BACKEND, "gemini-3.8-flash");
  assert.deepEqual(validateAgentPatch("workspace-agent", { model: "gemini-3.8-flash" }), { ok: true, patch: { model: "gemini-3.8-flash" } });
});

// --- spend summary -------------------------------------------------------------

const NOW = Date.parse("2026-10-12T06:30:00Z"); // 12:00 IST
const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();
const log = (agentKey, model, hours, promptTokens, completionTokens, cost) => ({ agentKey, model, source: "chat", promptTokens, completionTokens, cost, executedAt: ago(hours) });

test("summarizeSpend totals the 24h, 7d and 30d windows", () => {
  const s = summarizeSpend(
    [
      log("workspace-agent", "gpt-4o", 1, 1000, 200, 0.0045),
      log("workspace-agent", "claude-sonnet-5-5", 30, 2000, 500, 0.009),
      log("venue-sourcer", "gpt-4o", 24 * 10, 500, 100, 0.00225),
      log("venue-sourcer", "gpt-4o", 24 * 40, 9999, 9999, 1), // outside 30 days
      log("venue-sourcer", "gpt-4o", -1, 9999, 9999, 1), // in the future: ignored
    ],
    NOW
  );
  assert.deepEqual(s.last24h, { calls: 1, promptTokens: 1000, completionTokens: 200, cost: 0.0045, unpriced: 0 });
  assert.equal(s.last7d.calls, 2);
  assert.equal(s.last7d.cost, 0.0135);
  assert.equal(s.last30d.calls, 3);
  assert.equal(s.last30d.cost, 0.01575);
});

test("summarizeSpend ranks agents and models by cost and counts unpriced calls apart", () => {
  const s = summarizeSpend(
    [log("venue-sourcer", "gpt-4o", 2, 100, 10, 0.0004), log("workspace-agent", "gpt-4o", 3, 900, 90, 0.0031), log("workspace-agent", "mystery-model", 4, 50, 5, null)],
    NOW
  );
  assert.deepEqual(
    s.byAgent.map((a) => a.agentKey),
    ["workspace-agent", "venue-sourcer"]
  );
  assert.equal(s.byAgent[0].unpriced, 1);
  assert.equal(s.byAgent[0].cost, 0.0031);
  assert.deepEqual(
    s.byModel.map((m) => m.model),
    ["gpt-4o", "mystery-model"]
  );
  assert.equal(s.last30d.unpriced, 1);
});

test("summarizeSpend returns 14 IST days, zero-filled, ending today", () => {
  const s = summarizeSpend([log("workspace-agent", "gpt-4o", 1, 10, 10, 0.5)], NOW);
  assert.equal(s.daily.length, 14);
  assert.equal(s.daily.at(-1).day, "2026-10-12");
  assert.equal(s.daily.at(-1).cost, 0.5);
  assert.equal(s.daily[0].day, "2026-09-29");
  assert.ok(s.daily.slice(0, -1).every((d) => d.cost === 0 && d.tokens === 0));
});

test("istDay rolls over at midnight India time, not UTC", () => {
  assert.equal(istDay(Date.parse("2026-10-11T18:29:00Z")), "2026-10-11"); // 23:59 IST
  assert.equal(istDay(Date.parse("2026-10-11T18:31:00Z")), "2026-10-12"); // 00:01 IST
});

test("formatUsd and formatTokens keep small values readable", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.0042), "$0.0042");
  assert.equal(formatUsd(1.268), "$1.27");
  assert.equal(formatUsd(1204.4), "$1,204");
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(1234), "1.2k");
  assert.equal(formatTokens(48_000), "48k");
  assert.equal(formatTokens(2_500_000), "2.5M");
});

// --- run events ------------------------------------------------------------------

const feed = (parts) => {
  const mapper = createRunEventMapper();
  return { events: parts.flatMap((p) => mapper.push(p)), steps: mapper.steps };
};

test("a tool-using run maps to thought → tool call → tool response → final output", () => {
  const { events, steps } = feed([
    { type: "start" },
    { type: "start-step" },
    { type: "text-delta", id: "1", text: "Let me look " },
    { type: "text-delta", id: "1", text: "that up." },
    { type: "tool-call", toolCallId: "c1", toolName: "searchVenues", input: { minCapacity: 40 } },
    { type: "tool-result", toolCallId: "c1", toolName: "searchVenues", output: { total: 3 } },
    { type: "finish-step", finishReason: "tool-calls" },
    { type: "start-step" },
    { type: "text-delta", id: "2", text: "Three venues fit." },
    { type: "finish-step", finishReason: "stop" },
    { type: "finish" },
  ]);
  assert.deepEqual(events, [
    { type: "thought", step: 1, text: "Let me look that up." },
    { type: "tool_call", step: 1, toolCallId: "c1", toolName: "searchVenues", input: { minCapacity: 40 } },
    { type: "tool_response", step: 1, toolCallId: "c1", toolName: "searchVenues", ok: true, output: { total: 3 } },
    { type: "final_output", step: 2, text: "Three venues fit." },
  ]);
  assert.equal(steps, 2);
});

test("reasoning becomes a thought; tool errors and stream errors are reported", () => {
  const { events } = feed([
    { type: "start-step" },
    { type: "reasoning-delta", id: "r", text: "Budget question, " },
    { type: "reasoning-delta", id: "r", text: "use analyzeSpend." },
    { type: "reasoning-end", id: "r" },
    { type: "tool-call", toolCallId: "c1", toolName: "analyzeSpend", input: {} },
    { type: "tool-error", toolCallId: "c1", toolName: "analyzeSpend", error: new Error("No bookings") },
    { type: "error", error: "Provider down" },
  ]);
  assert.deepEqual(events, [
    { type: "thought", step: 1, text: "Budget question, use analyzeSpend." },
    { type: "tool_call", step: 1, toolCallId: "c1", toolName: "analyzeSpend", input: {} },
    { type: "tool_response", step: 1, toolCallId: "c1", toolName: "analyzeSpend", ok: false, output: "No bookings" },
    { type: "error", message: "Provider down" },
  ]);
});

test("large tool payloads are clipped", () => {
  const big = { rows: "x".repeat(MAX_PAYLOAD_CHARS * 2) };
  const clipped = clipPayload(big);
  assert.equal(clipped.truncated, true);
  assert.equal(clipped.preview.length, MAX_PAYLOAD_CHARS);
  assert.deepEqual(clipPayload({ a: 1 }), { a: 1 });
});

test("encoded events parse back, across chunk boundaries, skipping heartbeats and junk", () => {
  const a = { type: "thought", step: 1, text: "hi\nthere" };
  const b = { type: "done", steps: 1, durationMs: 12 };
  const wire = encodeRunEvent(a, 1) + ": keep-alive\n\n" + "event: x\ndata: {not json\n\n" + encodeRunEvent(b, 2);
  assert.match(encodeRunEvent(a, 1), /^id: 1\nevent: thought\ndata: /);

  const cut = wire.length - 10;
  const first = parseSseFrames(wire.slice(0, cut));
  assert.deepEqual(first.events, [a]);
  const second = parseSseFrames(first.rest + wire.slice(cut));
  assert.deepEqual(second.events, [b]);
  assert.equal(second.rest, "");
});
