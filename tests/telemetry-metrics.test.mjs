import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTelemetryMetrics, metricChange } from "../lib/telemetry/metrics.ts";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const run = (minutesAgo, over = {}) => ({
  agent: "workspace-agent",
  at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  ok: true,
  durationMs: 1000,
  tokens: 1200,
  ...over,
});
const byId = (metrics) => Object.fromEntries(metrics.map((m) => [m.id, m]));

test("no runs: zeroed metrics, 24 flat buckets, no deltas", () => {
  const m = byId(computeTelemetryMetrics([], NOW, 3));
  assert.equal(m["active-agents"].value, "0");
  assert.equal(m["active-agents"].unit, "/ 3");
  assert.equal(m["system-latency"].value, "—");
  assert.equal(m["success-rate"].value, "—");
  for (const metric of Object.values(m)) {
    assert.equal(metric.series.length, 24);
    assert.equal(metric.delta, 0);
  }
});

test("counts only the last 2 hours and compares with the 2 hours before", () => {
  const runs = [
    run(5),
    run(30, { agent: "channel-concierge", ok: false, durationMs: 3000, tokens: 0 }),
    run(100, { agent: "venue-sourcer", durationMs: 2000, tokens: 600 }),
    run(150), // previous window
    run(300), // too old
  ];
  const m = byId(computeTelemetryMetrics(runs, NOW, 2));
  assert.equal(m["active-agents"].value, "3");
  assert.equal(m["active-agents"].unit, "/ 3"); // never below what actually ran
  assert.equal(m["active-agents"].delta, 2); // 3 agents vs 1
  assert.equal(m["token-throughput"].detail, "1.8k tokens in last 2 h");
  assert.equal(m["token-throughput"].value, "15"); // 1800 tokens / 120 min
  assert.equal(m["system-latency"].value, "2000");
  assert.equal(m["success-rate"].value, "66.7");
  assert.equal(m["success-rate"].detail, "2 of 3 tasks");
});

test("buckets: newest run lands in the last bucket; empty buckets carry latency forward", () => {
  const m = byId(computeTelemetryMetrics([run(1, { durationMs: 800 }), run(61, { durationMs: 400 })], NOW, 1));
  const latency = m["system-latency"].series;
  assert.equal(latency.at(-1), 800);
  assert.equal(latency[0], 400); // before the first run: first reading
  assert.equal(latency[15], 400); // between runs: carried forward
  assert.equal(m["active-agents"].series.at(-1), 1);
  assert.equal(m["active-agents"].series.at(-2), 0);
});

import { summarizeRuns } from "../lib/telemetry/metrics.ts";

test("summarizeRuns: IST day buckets, previous window, breakdowns and failures", () => {
  // 12:00 UTC = 17:30 IST on 8 Oct.
  const runs = [
    run(10, { agent: "a", channel: "web" }),
    run(60 * 20, { agent: "b", channel: "whatsapp", ok: false, error: "timeout", task: "Find a venue" }), // 7 Oct, 21:30 IST
    run(60 * 24 * 8, { agent: "a" }), // previous window
    run(60 * 24 * 40, { agent: "a" }), // out of both
  ];
  const s = summarizeRuns(runs, NOW, "7d");
  assert.equal(s.buckets.length, 7);
  assert.equal(s.from, "2026-10-01T18:30:00.000Z"); // 2 Oct 00:00 IST
  assert.equal(s.buckets.at(-1).start, "2026-10-07T18:30:00.000Z"); // 8 Oct 00:00 IST
  assert.equal(s.buckets.at(-1).ok, 1);
  assert.equal(s.buckets.at(-2).failed, 1);
  assert.equal(s.totals.runs, 2);
  assert.equal(s.totals.successRate, 50);
  assert.equal(s.previous.runs, 1);
  assert.deepEqual(s.agents.map((a) => [a.agent, a.runs, a.failed]), [["a", 1, 0], ["b", 1, 1]]);
  assert.deepEqual(s.channels.map((c) => c.channel).sort(), ["web", "whatsapp"]);
  assert.deepEqual(s.failures.map((f) => [f.agent, f.error, f.task]), [["b", "timeout", "Find a venue"]]);
});

test("summarizeRuns: 24h uses IST hour buckets; empty buckets have no latency", () => {
  const s = summarizeRuns([run(5, { durationMs: 700 })], NOW, "24h");
  assert.equal(s.buckets.length, 24);
  assert.equal(s.buckets.at(-1).start, "2026-10-08T11:30:00.000Z"); // 17:00 IST
  assert.equal(s.buckets.at(-1).p50Ms, 700);
  assert.equal(s.buckets[0].p50Ms, null);
  assert.equal(summarizeRuns([], NOW, "30d").totals.successRate, null);
});

test("metricChange: relative change with a sign, rounded to whole percent", () => {
  assert.deepEqual(metricChange(112, 100, { unit: "%", better: "neither" }), { label: "+12%", direction: "up", intent: "neutral" });
  assert.deepEqual(metricChange(85, 100, { unit: "%", better: "neither" }), { label: "−15%", direction: "down", intent: "neutral" });
});

test("metricChange: intent follows which direction is better", () => {
  assert.equal(metricChange(2400, 2000, { unit: "%", better: "down" })?.intent, "bad"); // latency up
  assert.equal(metricChange(1600, 2000, { unit: "%", better: "down" })?.intent, "good"); // latency down
  assert.deepEqual(metricChange(90.7, 91.9, { unit: "pts", better: "up" }), { label: "−1.2 pts", direction: "down", intent: "bad" });
});

test("metricChange: changes that round to zero are flat and neutral", () => {
  assert.deepEqual(metricChange(1004, 1000, { unit: "%", better: "up" }), { label: "0%", direction: "flat", intent: "neutral" });
  assert.deepEqual(metricChange(91.92, 91.9, { unit: "pts", better: "up" }), { label: "0.0 pts", direction: "flat", intent: "neutral" });
});

test("metricChange: nothing to compare gives null", () => {
  assert.equal(metricChange(null, 10, { unit: "%", better: "up" }), null);
  assert.equal(metricChange(10, null, { unit: "pts", better: "up" }), null);
  assert.equal(metricChange(10, 0, { unit: "%", better: "up" }), null); // relative change from zero
  assert.deepEqual(metricChange(0, 0, { unit: "pts", better: "up" })?.label, "0.0 pts");
});
