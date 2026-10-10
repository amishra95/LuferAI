import "server-only";

import { after } from "next/server";

import { getDataRedis } from "@/lib/data/local-store";
import { publishRun } from "@/lib/telemetry/live";
import type { AgentId, AgentRun } from "@/types/agents";

/** Configured agents (lib/agents/store.ts) plus the single-purpose /api/ai/* routes. */
export type RunAgent = AgentId | "brief-writer" | "rfp-broadcaster" | "property-negotiator";
import type { TaskChannel } from "@/types/channels";

/**
 * Agent run log behind the Overview metrics and the Agents page counters.
 *
 * Every run (workspace chat, channel concierge, AI routes, agent tests) is pushed
 * onto a capped Redis list, and per-agent run counts and last runs are kept in two
 * hashes, so the numbers are shared across instances and survive restarts. Without
 * Upstash the same data is kept in process memory.
 */

export interface LoggedRun extends AgentRun {
  id: string;
  agent: RunAgent;
  /** Short description for the activity feed, e.g. "Event brief for booking 1a2b3c4d". */
  task: string;
  channel: TaskChannel;
  tokens: number;
  steps: number;
}

export type NewRun = AgentRun & { task?: string; tokens?: number; steps?: number };

const RUNS_KEY = "lufer:telemetry:runs";
const COUNTS_KEY = "lufer:telemetry:run-counts";
const LAST_KEY = "lufer:telemetry:last-run";
/** The log keeps the most recent runs only; older ones are trimmed. */
export const RUN_LOG_LIMIT = 2000;
const MAX_RUNS = RUN_LOG_LIMIT;

interface MemoryLog {
  runs: LoggedRun[];
  counts: Map<string, number>;
  last: Map<string, LoggedRun>;
}
const g = globalThis as typeof globalThis & { __luferRuns?: MemoryLog };
const memory: MemoryLog = (g.__luferRuns ??= { runs: [], counts: new Map(), last: new Map() });

const channelOf = (source: AgentRun["source"]): TaskChannel => (source === "whatsapp" || source === "slack" ? source : "web");

async function write(run: LoggedRun) {
  const redis = getDataRedis();
  if (!redis) {
    memory.runs.unshift(run);
    memory.runs.length = Math.min(memory.runs.length, MAX_RUNS);
    memory.counts.set(run.agent, (memory.counts.get(run.agent) ?? 0) + 1);
    memory.last.set(run.agent, run);
    return;
  }
  const json = JSON.stringify(run);
  await redis
    .pipeline()
    .lpush(RUNS_KEY, json)
    .ltrim(RUNS_KEY, 0, MAX_RUNS - 1)
    .hincrby(COUNTS_KEY, run.agent, 1)
    .hset(LAST_KEY, { [run.agent]: json })
    .exec();
}

/**
 * Records a run. Never throws: telemetry must not fail the request. The write is
 * also handed to `after()` so it completes even if the response has already been sent.
 */
export function logAgentRun(agent: RunAgent, run: NewRun): Promise<void> {
  const logged: LoggedRun = {
    ...run,
    id: crypto.randomUUID(),
    agent,
    task: run.task ?? (run.source === "test" ? "Tool smoke test" : "Agent run"),
    channel: channelOf(run.source),
    tokens: Math.max(0, Math.round(run.tokens ?? 0)),
    steps: Math.max(0, run.steps ?? 0),
  };
  const p = write(logged)
    .then(() => publishRun(logged))
    .catch((err) => console.error("telemetry: could not record agent run", err));
  try {
    after(p);
  } catch {
    // Outside a request (tests, scripts): the promise still runs.
  }
  return p;
}

/** One line of user text for a run's task label. */
export const clip = (text: string, max = 80) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

const parse = (v: unknown): LoggedRun => (typeof v === "string" ? JSON.parse(v) : v) as LoggedRun;

/** Most recent runs first. */
export async function listAgentRuns(limit = MAX_RUNS): Promise<LoggedRun[]> {
  const redis = getDataRedis();
  if (!redis) return memory.runs.slice(0, limit);
  return (await redis.lrange<unknown>(RUNS_KEY, 0, limit - 1)).map(parse);
}

/** Per-agent run counts and last runs. */
export async function agentRunStats(): Promise<Map<string, { runCount: number; lastRun: LoggedRun | null }>> {
  const redis = getDataRedis();
  const out = new Map<string, { runCount: number; lastRun: LoggedRun | null }>();
  let counts: Record<string, unknown> = Object.fromEntries(memory.counts);
  let last: Record<string, unknown> = Object.fromEntries(memory.last);
  if (redis) {
    const [c, l] = await redis.pipeline().hgetall(COUNTS_KEY).hgetall(LAST_KEY).exec<[Record<string, unknown> | null, Record<string, unknown> | null]>();
    counts = c ?? {};
    last = l ?? {};
  }
  for (const id of new Set([...Object.keys(counts), ...Object.keys(last)])) {
    out.set(id, { runCount: Number(counts[id] ?? 0), lastRun: last[id] ? parse(last[id]) : null });
  }
  return out;
}

export { computeTelemetryMetrics } from "./metrics";
