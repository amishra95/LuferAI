import type { AgentTaskEvent, TelemetryMetric } from "@/types/telemetry";

/**
 * Static sample telemetry for the Overview page. Nothing in the app emits agent
 * metrics yet; replace these two functions with real queries when it does.
 */
export const TELEMETRY_SOURCE = "sample" as const;

// Deterministic jitter so server and client renders agree.
function series(base: number, spread: number, seed: number, trend = 0): number[] {
  return Array.from({ length: 24 }, (_, i) => {
    const wave = Math.sin((i + seed) * 0.9) * 0.6 + Math.sin((i + seed * 3) * 0.37) * 0.4;
    return Math.max(0, base + wave * spread + trend * i);
  });
}

export function getTelemetryMetrics(): TelemetryMetric[] {
  return [
    {
      id: "active-agents",
      label: "Active agents",
      value: "14",
      unit: "/ 20",
      detail: "3 idle · 3 offline",
      delta: 0.17,
      higherIsBetter: true,
      series: series(11, 2, 1, 0.12).map(Math.round),
      format: "int",
    },
    {
      id: "token-throughput",
      label: "Token throughput",
      value: "48.2k",
      unit: "tok/min",
      detail: "1.16M tokens in last 24h",
      delta: 0.08,
      higherIsBetter: true,
      series: series(44_000, 6_000, 4, 150),
      format: "tokens",
    },
    {
      id: "system-latency",
      label: "System latency",
      value: "612",
      unit: "ms p50",
      detail: "p95 1.84 s · p99 3.10 s",
      delta: -0.06,
      higherIsBetter: false,
      series: series(640, 70, 7, -2),
      format: "ms",
    },
    {
      id: "success-rate",
      label: "Success rate",
      value: "98.4",
      unit: "%",
      detail: "1,912 of 1,943 tasks",
      delta: -0.004,
      higherIsBetter: true,
      series: series(98.5, 0.6, 2).map((v) => Math.min(100, v)),
      format: "percent",
    },
  ];
}

export function getRecentAgentTasks(now = new Date("2026-10-07T12:00:00Z")): AgentTaskEvent[] {
  const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
  return [
    { id: "tsk_9f21", agent: "venue-sourcer", task: "Shortlist venues for 120-guest offsite", status: "running", step: 2, totalSteps: 4, durationMs: null, tokens: 3_412, startedAt: ago(14), log: "Querying venue catalogue (capacity ≥ 120, Whitefield)" },
    { id: "tsk_9f1e", agent: "brief-writer", task: "Generate event brief for booking BK-2291", status: "succeeded", step: 3, totalSteps: 3, durationMs: 4_820, tokens: 6_904, startedAt: ago(52), log: "Brief saved · 3 sections, 412 words" },
    { id: "tsk_9f1a", agent: "policy-checker", task: "Evaluate booking against corporate policy", status: "succeeded", step: 2, totalSteps: 2, durationMs: 910, tokens: 1_204, startedAt: ago(95), log: "Policy compliant · under per-head cap" },
    { id: "tsk_9f17", agent: "invoice-reconciler", task: "Reconcile GST invoices for September", status: "failed", step: 3, totalSteps: 5, durationMs: 12_330, tokens: 9_870, startedAt: ago(180), log: "GSTIN mismatch on 2 invoices · retry scheduled" },
    { id: "tsk_9f15", agent: "venue-sourcer", task: "Find private dining for 18 in Indiranagar", status: "succeeded", step: 4, totalSteps: 4, durationMs: 6_140, tokens: 5_377, startedAt: ago(260), log: "Returned 4 options · 3 policy compliant" },
    { id: "tsk_9f14", agent: "hold-monitor", task: "Release expired inventory holds", status: "queued", step: 0, totalSteps: 2, durationMs: null, tokens: 0, startedAt: ago(300), log: "Waiting for worker slot" },
    { id: "tsk_9f10", agent: "brief-writer", task: "Generate event brief for booking BK-2287", status: "succeeded", step: 3, totalSteps: 3, durationMs: 5_210, tokens: 7_118, startedAt: ago(420), log: "Brief saved · 4 sections, 506 words" },
    { id: "tsk_9f0c", agent: "policy-checker", task: "Evaluate booking against corporate policy", status: "succeeded", step: 2, totalSteps: 2, durationMs: 870, tokens: 1_090, startedAt: ago(610), log: "Requires manager approval · over per-head cap" },
  ];
}
