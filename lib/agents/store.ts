import "server-only";

import type { AGENT_IDS, AgentToolName } from "@/lib/agents/config";
import { agentRunStats, logAgentRun, type NewRun } from "@/lib/telemetry/runs";
import type { AgentConfig, AgentId, AgentRecord, AgentStatus } from "@/types/agents";
import type { ChatToolName } from "@/types/chat";

// lib/agents/config.ts lists the tools without importing app types; keep the two lists identical.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const listsMatch: [Same<AgentToolName, ChatToolName>, Same<(typeof AGENT_IDS)[number], AgentId>] = [true, true];
void listsMatch;

/**
 * Agent configs, held in server memory on globalThis (same approach as
 * lib/data/mock-store.ts): survives hot reloads, resets on restart, and is
 * per-instance when deployed. Run history (counts, last run, the Overview
 * metrics) is recorded in Upstash Redis by lib/telemetry/runs.ts.
 */
const DEFAULTS: AgentConfig[] = [
  {
    id: "workspace-agent",
    name: "Workspace agent",
    description: "Answers questions in the Chat workspace. Its settings apply to /api/chat.",
    enabled: true,
    tools: ["searchVenues", "getPlatformMetrics", "analyzeSpend", "forecastBudget"],
    temperature: null,
    maxSteps: 5,
    instructions: "",
  },
  {
    id: "channel-concierge",
    name: "Channel concierge",
    description: "Answers WhatsApp and Slack messages: finds venues, and files booking requests for linked senders.",
    enabled: true,
    tools: ["searchVenues"],
    temperature: 0.2,
    maxSteps: 4,
    instructions: "",
  },
  {
    id: "venue-sourcer",
    name: "Venue sourcer",
    description: "Shortlists catalogue venues for an event brief.",
    enabled: true,
    tools: ["searchVenues"],
    temperature: 0.2,
    maxSteps: 3,
    instructions: "",
  },
  {
    id: "metrics-reporter",
    name: "Metrics reporter",
    description: "Summarises bookings, GBV, commission, spend trends and budget forecasts for operations.",
    enabled: false,
    tools: ["getPlatformMetrics", "analyzeSpend", "forecastBudget"],
    temperature: 0,
    maxSteps: 2,
    instructions: "",
  },
];

/** A successful run within this window counts as "active". */
const ACTIVE_WINDOW_MS = 10 * 60_000;

const g = globalThis as typeof globalThis & { __luferAgents?: Map<AgentId, AgentRecord> };
const agents = (g.__luferAgents ??= new Map());
// Backfill defaults (also covers agents added since this process started).
for (const a of DEFAULTS) {
  if (!agents.has(a.id)) agents.set(a.id, { ...a, lastRun: null, runCount: 0 });
  // Records kept from before a field existed (`next dev` reloads).
  else agents.get(a.id)!.instructions ??= "";
}

export function listAgents(): AgentRecord[] {
  return [...agents.values()].map((a) => ({ ...a, tools: [...a.tools] }));
}

export function getAgent(id: AgentId): AgentRecord | null {
  const a = agents.get(id);
  return a ? { ...a, tools: [...a.tools] } : null;
}

export function isAgentId(id: string): id is AgentId {
  return agents.has(id as AgentId);
}

export function updateAgent(id: AgentId, patch: Partial<Omit<AgentConfig, "id" | "name" | "description">>): AgentRecord {
  const a = agents.get(id);
  if (!a) throw new Error(`Unknown agent ${id}`);
  Object.assign(a, patch);
  return getAgent(id)!;
}

/** Records a run in the shared run log. Resolves once written; never rejects. */
export function recordRun(id: AgentId, run: NewRun): Promise<void> {
  const a = agents.get(id);
  if (!a) return Promise.resolve();
  a.lastRun = run;
  a.runCount += 1;
  return logAgentRun(id, run);
}

export function agentStatus(a: AgentRecord, now = Date.now()): AgentStatus {
  if (!a.enabled) return "disabled";
  if (a.lastRun && !a.lastRun.ok) return "error";
  if (a.lastRun && now - new Date(a.lastRun.at).getTime() < ACTIVE_WINDOW_MS) return "active";
  return "idle";
}

/** All agents with run history from the shared log and their derived status, as of one instant. */
export async function agentSnapshot() {
  const now = Date.now();
  const stats = await agentRunStats().catch((err) => {
    console.error("agents: run log unavailable; showing this instance's runs", err);
    return null;
  });
  return {
    now,
    agents: listAgents().map((a) => {
      const s = stats?.get(a.id);
      const agent: AgentRecord = s ? { ...a, runCount: s.runCount, lastRun: s.lastRun } : a;
      return { agent, status: agentStatus(agent, now) };
    }),
  };
}
