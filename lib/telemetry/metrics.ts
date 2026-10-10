/**
 * Overview metrics from the agent run log (lib/telemetry/runs.ts): the last 2 hours
 * in 24 five-minute buckets, compared with the 2 hours before. Pure, so it's unit
 * tested (tests/telemetry-metrics.test.mjs).
 */
import type { TelemetryMetric } from "../../types/telemetry.ts";

/** The fields of a logged run the metrics read. */
export interface MetricRun {
  /** The run log entry's id (lib/telemetry/runs.ts), for opening it in the inspector. */
  id?: string;
  agent: string;
  at: string; // ISO, when the run finished
  ok: boolean;
  durationMs: number;
  tokens: number;
  channel?: string;
  task?: string;
  error?: string;
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

// ----------------------------------------------------------------------------
// Admin analytics (/admin/analytics): a 24 h / 7 d / 30 d window in calendar
// buckets (IST hours or days), with per-agent and per-channel breakdowns.
// ----------------------------------------------------------------------------

export const RUN_RANGES = ["24h", "7d", "30d"] as const;
export type RunRange = (typeof RUN_RANGES)[number];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** India has no DST, so IST is a fixed +05:30. */
const IST_OFFSET_MS = 5.5 * HOUR_MS;

const RANGE: Record<RunRange, { bucketMs: number; buckets: number }> = {
  "24h": { bucketMs: HOUR_MS, buckets: 24 },
  "7d": { bucketMs: DAY_MS, buckets: 7 },
  "30d": { bucketMs: DAY_MS, buckets: 30 },
};

/** Start of the IST hour or day containing `t`. */
const bucketStart = (t: number, bucketMs: number) => Math.floor((t + IST_OFFSET_MS) / bucketMs) * bucketMs - IST_OFFSET_MS;

export interface RunTotals {
  runs: number;
  ok: number;
  failed: number;
  /** null when there were no runs. */
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  tokens: number;
}

export interface RunBucket {
  start: string; // ISO
  ok: number;
  failed: number;
  tokens: number;
  p50Ms: number | null;
}

export interface AgentBreakdown extends RunTotals {
  agent: string;
  lastAt: string;
}

export interface RunsSummary {
  range: RunRange;
  bucketMs: number;
  from: string;
  to: string;
  totals: RunTotals;
  /** The same-length window before, for change figures. */
  previous: RunTotals;
  buckets: RunBucket[];
  agents: AgentBreakdown[];
  channels: { channel: string; runs: number; failed: number; tokens: number }[];
  failures: { id: string | null; at: string; agent: string; task: string; error: string; channel: string }[];
}

/** Whether a move is welcome: success rate up is good, latency up is bad, volume is neither. */
export type ChangeIntent = "good" | "bad" | "neutral";

export interface MetricChange {
  /** "+12%", "−1.2 pts", "0%". */
  label: string;
  direction: "up" | "down" | "flat";
  intent: ChangeIntent;
}

/**
 * Change from the previous window, for the summary pills: relative ("%") or
 * absolute percentage points ("pts"). Null when there's nothing to compare
 * (no runs now or before, or a relative change from zero).
 */
export function metricChange(now: number | null, before: number | null, options: { unit: "%" | "pts"; better: "up" | "down" | "neither" }): MetricChange | null {
  if (now === null || before === null) return null;
  if (options.unit === "%" && before === 0) return null;
  const raw = options.unit === "pts" ? now - before : ((now - before) / before) * 100;
  const shown = Math.abs(raw).toFixed(options.unit === "pts" ? 1 : 0);
  const direction = Number(shown) === 0 ? "flat" : raw > 0 ? "up" : "down";
  const sign = direction === "flat" ? "" : direction === "up" ? "+" : "\u2212";
  const intent: ChangeIntent = direction === "flat" || options.better === "neither" ? "neutral" : direction === options.better ? "good" : "bad";
  return { label: `${sign}${shown}${options.unit === "pts" ? " pts" : "%"}`, direction, intent };
}

export function totalsOf(runs: MetricRun[]): RunTotals {
  const ok = runs.filter((r) => r.ok).length;
  const latencies = runs.map((r) => r.durationMs).sort((a, b) => a - b);
  return {
    runs: runs.length,
    ok,
    failed: runs.length - ok,
    successRate: runs.length ? (ok / runs.length) * 100 : null,
    p50Ms: runs.length ? percentile(latencies, 50) : null,
    p95Ms: runs.length ? percentile(latencies, 95) : null,
    tokens: runs.reduce((s, r) => s + r.tokens, 0),
  };
}

/** Pure: the analytics for `range` ending at `now`. Runs may be in any order. */
export function summarizeRuns(runs: MetricRun[], now: number, range: RunRange): RunsSummary {
  const { bucketMs, buckets: count } = RANGE[range];
  // Calendar buckets: the current (partial) hour/day plus the ones before it.
  const first = bucketStart(now, bucketMs) - (count - 1) * bucketMs;
  const span = now - first;
  const t = (r: MetricRun) => new Date(r.at).getTime();
  const inRange = runs.filter((r) => t(r) >= first && t(r) <= now);
  const before = runs.filter((r) => t(r) >= first - span && t(r) < first);

  const buckets: RunBucket[] = Array.from({ length: count }, (_, i) => {
    const start = first + i * bucketMs;
    const rows = inRange.filter((r) => t(r) >= start && t(r) < start + bucketMs);
    const totals = totalsOf(rows);
    return { start: new Date(start).toISOString(), ok: totals.ok, failed: totals.failed, tokens: totals.tokens, p50Ms: totals.p50Ms };
  });

  const byKey = <K extends string>(key: (r: MetricRun) => K) => {
    const groups = new Map<K, MetricRun[]>();
    for (const r of inRange) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
    return groups;
  };

  const agents = [...byKey((r) => r.agent)]
    .map(([agent, rows]) => ({ agent, ...totalsOf(rows), lastAt: rows.map((r) => r.at).sort().at(-1)! }))
    .sort((a, b) => b.runs - a.runs || a.agent.localeCompare(b.agent));

  const channels = [...byKey((r) => r.channel ?? "web")]
    .map(([channel, rows]) => {
      const totals = totalsOf(rows);
      return { channel, runs: totals.runs, failed: totals.failed, tokens: totals.tokens };
    })
    .sort((a, b) => b.runs - a.runs);

  const failures = inRange
    .filter((r) => !r.ok)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10)
    .map((r) => ({ id: r.id ?? null, at: r.at, agent: r.agent, task: r.task ?? "Agent run", error: r.error ?? "No error message recorded", channel: r.channel ?? "web" }));

  return {
    range,
    bucketMs,
    from: new Date(first).toISOString(),
    to: new Date(now).toISOString(),
    totals: totalsOf(inRange),
    previous: totalsOf(before),
    buckets,
    agents,
    channels,
    failures,
  };
}
