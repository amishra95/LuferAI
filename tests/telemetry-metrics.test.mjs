import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTelemetryMetrics } from "../lib/telemetry/metrics.ts";

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
