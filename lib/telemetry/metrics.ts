/**
 * Overview metrics from the agent run log (lib/telemetry/runs.ts): the last 2 hours
 * in 24 five-minute buckets, compared with the 2 hours before. Pure, so it's unit
 * tested (tests/telemetry-metrics.test.mjs).
 */
import type { TelemetryMetric } from "../../types/telemetry.ts";

/** The fields of a logged run the metrics read. */
export interface MetricRun {
  agent: string;
  at: string; // ISO, when the run finished
  ok: boolean;
  durationMs: number;
  tokens: number;
}

// ----------------------------------------------------------------------------

const BUCKET_MS = 5 * 60_000;
const BUCKETS = 24;
const WINDOW_MS = BUCKET_MS * BUCKETS;

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const change = (now: number, prev: number) => (prev === 0 ? 0 : (now - prev) / prev);

/** Empty buckets repeat the last reading so latency and success lines don't dive to zero. */
function carryForward(values: (number | null)[]): number[] {
  let last = values.find((v) => v !== null) ?? 0;
  return values.map((v) => (v === null ? last : (last = v)));
}

function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

interface WindowStats {
  runs: MetricRun[];
  agents: number;
  tokens: number;
  latencies: number[];
  ok: number;
}

function stats(runs: MetricRun[]): WindowStats {
  return {
    runs,
    agents: new Set(runs.map((r) => r.agent)).size,
    tokens: runs.reduce((s, r) => s + r.tokens, 0),
    latencies: runs.map((r) => r.durationMs).sort((a, b) => a - b),
    ok: runs.filter((r) => r.ok).length,
  };
}

/** Pure: metrics from a run log as of `now`. Exported for tests. */
export function computeTelemetryMetrics(runs: MetricRun[], now: number, agentsTotal: number): TelemetryMetric[] {
  const t = (r: MetricRun) => new Date(r.at).getTime();
  const cur = stats(runs.filter((r) => t(r) > now - WINDOW_MS && t(r) <= now));
  const prev = stats(runs.filter((r) => t(r) > now - 2 * WINDOW_MS && t(r) <= now - WINDOW_MS));

  const buckets = Array.from({ length: BUCKETS }, (_, i) => {
    const end = now - (BUCKETS - 1 - i) * BUCKET_MS;
    return stats(cur.runs.filter((r) => t(r) > end - BUCKET_MS && t(r) <= end));
  });

  const minutes = WINDOW_MS / 60_000;
  const p50 = percentile(cur.latencies, 50);
  const successRate = (s: WindowStats) => (s.runs.length ? (s.ok / s.runs.length) * 100 : 0);
  const empty = cur.runs.length === 0;

  return [
    {
      id: "active-agents",
      label: "Active agents",
      value: String(cur.agents),
      unit: `/ ${Math.max(agentsTotal, cur.agents)}`,
      detail: empty ? "No agent runs in the last 2 h" : `${cur.runs.length} run${cur.runs.length === 1 ? "" : "s"} in the last 2 h`,
      delta: change(cur.agents, prev.agents),
      higherIsBetter: true,
      series: buckets.map((b) => b.agents),
      format: "int",
    },
    {
      id: "token-throughput",
      label: "Token throughput",
      value: compact(cur.tokens / minutes),
      unit: "tok/min",
      detail: `${compact(cur.tokens)} tokens in last 2 h`,
      delta: change(cur.tokens, prev.tokens),
      higherIsBetter: true,
      series: buckets.map((b) => b.tokens / (BUCKET_MS / 60_000)),
      format: "tokens",
    },
    {
      id: "system-latency",
      label: "System latency",
      value: empty ? "—" : String(Math.round(p50)),
      unit: "ms p50",
      detail: empty
        ? "No runs to measure"
        : `p95 ${(percentile(cur.latencies, 95) / 1000).toFixed(2)} s · p99 ${(percentile(cur.latencies, 99) / 1000).toFixed(2)} s`,
      delta: change(p50, percentile(prev.latencies, 50)),
      higherIsBetter: false,
      series: carryForward(buckets.map((b) => (b.latencies.length ? percentile(b.latencies, 50) : null))),
      format: "ms",
    },
    {
      id: "success-rate",
      label: "Success rate",
      value: empty ? "—" : successRate(cur).toFixed(1),
      unit: "%",
      detail: `${cur.ok.toLocaleString("en-IN")} of ${cur.runs.length.toLocaleString("en-IN")} tasks`,
      delta: empty || prev.runs.length === 0 ? 0 : change(successRate(cur), successRate(prev)),
      higherIsBetter: true,
      series: carryForward(buckets.map((b) => (b.runs.length ? successRate(b) : null))),
      format: "percent",
    },
  ];
}
