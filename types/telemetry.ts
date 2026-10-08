export type TelemetryMetric = {
  id: "active-agents" | "token-throughput" | "system-latency" | "success-rate";
  label: string;
  value: string;
  unit?: string;
  /** Secondary reading shown under the value, e.g. "p95 1.84 s". */
  detail: string;
  /** Change vs. the previous window, as a signed fraction (0.12 = +12%). */
  delta: number;
  /** Whether a rising value is good. Decides how the delta is coloured. */
  higherIsBetter: boolean;
  /** Last 24 readings, oldest first, one per 5-minute bucket. */
  series: number[];
  /** Formats a series value for the hover readout. */
  format: "int" | "tokens" | "ms" | "percent";
};

import type { TaskChannel } from "@/types/channels";

export type TaskStatus = "running" | "succeeded" | "failed" | "queued";

export type AgentTaskEvent = {
  id: string;
  agent: string;
  task: string;
  status: TaskStatus;
  /** Current step for running tasks, final step count otherwise. */
  step: number;
  totalSteps: number;
  durationMs: number | null;
  tokens: number;
  startedAt: string; // ISO
  /** Latest log line from the agent. */
  log: string;
  /** Where the task came from: WhatsApp, Slack or the web app. */
  channel: TaskChannel;
};
