import type { ModelBackend } from "@/lib/agents/config";
import type { ChatToolName } from "@/types/chat";

export type AgentId = "workspace-agent" | "channel-concierge" | "venue-sourcer" | "metrics-reporter";

export type AgentStatus = "active" | "idle" | "error" | "disabled";

export type AgentConfig = {
  id: AgentId;
  name: string;
  description: string;
  enabled: boolean;
  tools: ChatToolName[];
  /** null = the model's default. */
  temperature: number | null;
  maxSteps: number;
  /** Operator instructions appended to the system prompt ("" = none; promptable agents only). */
  instructions: string;
  /** Which model the agent runs on (lib/ai/model.ts). */
  model: ModelBackend;
};

export type AgentRun = {
  at: string; // ISO
  ok: boolean;
  durationMs: number;
  /** "api": one of the /api/ai/* routes. */
  source: "chat" | "test" | "whatsapp" | "slack" | "api";
  error?: string;
};

export type AgentRecord = AgentConfig & {
  lastRun: AgentRun | null;
  runCount: number;
};

export type AgentTestResult = {
  ok: boolean;
  durationMs: number;
  tools: { name: ChatToolName; ok: boolean; durationMs: number; summary: string }[];
};

/** What a row in the /agents activity feed records. */
export type TraceKind = "negotiation" | "guardrail" | "prompt";

/** Feed badge: Success, Auto-Counter, Auto-Decline, Escalated, Error/Fallback. */
export type TraceOutcome = "success" | "auto-counter" | "auto-decline" | "escalated" | "fallback";

export type ObservabilityEvent = {
  id: string;
  at: string; // ISO
  kind: TraceKind;
  outcome: TraceOutcome;
  /** Run-log agent id, or "host" for a venue host's own counter/decline. */
  agent: string;
  title: string;
  detail: string;
  durationMs: number | null;
  tokens: number | null;
  /** For drilling into the full trace (span names, timings) on /admin/analytics. */
  traceId: string | null;
  /** Key facts, e.g. ["proposed", "₹40,000"]. */
  facts: [string, string][];
  /** A person acted, not a model or rule. */
  manual?: boolean;
  /** For failures: what people do instead while the AI path is down. */
  fallback?: string;
};

export type ProviderHealth = {
  /** The default backend (what the AI routes use) has an API key. */
  configured: boolean;
  /** Every model backend agents can be switched to, and whether it has a key. */
  backends: { id: string; label: string; configured: boolean }[];
  circuit: "CLOSED" | "OPEN" | "HALF_OPEN";
  consecutiveFailures: number;
  /** Epoch ms, when an open circuit next lets a trial call through. */
  retryAt: number | null;
  /** Breaker counters: all instances over the last 24 h, or this instance since start when `store` is "instance". */
  stats: { calls: number; failures: number; rejected: number; retries: number };
  /** Error/Fallback events in the last 24 hours. */
  fallbacks24h: number;
  /** Where the counters and states come from: shared Redis, this process's memory store, or (store unreadable) the live breaker only. */
  store: "redis" | "memory" | "instance";
  /** Instances heard from in the last 24 h, this one included. */
  instances: number;
  /** Of those, how many have the circuit open or half-open right now. */
  degradedInstances: number;
  /** Latest state changes, newest first. */
  transitions: { instance: string; from: "CLOSED" | "OPEN" | "HALF_OPEN"; to: "CLOSED" | "OPEN" | "HALF_OPEN"; at: number }[];
};
