import "server-only";

import type { AgentConfig, AgentId, AgentRecord, AgentRun, AgentStatus } from "@/types/agents";

/**
 * Agent configs and run history, held in server memory on globalThis (same
 * approach as lib/data/mock-store.ts): survives hot reloads, resets on restart,
 * and is per-instance when deployed. Move to a Supabase table to persist.
 */
const DEFAULTS: AgentConfig[] = [
  {
    id: "workspace-agent",
    name: "Workspace agent",
    description: "Answers questions in the Chat workspace. Its settings apply to /api/chat.",
    enabled: true,
    tools: ["searchVenues", "getPlatformMetrics"],
    temperature: null,
    maxSteps: 5,
  },
  {
    id: "channel-concierge",
    name: "Channel concierge",
    description: "Answers WhatsApp and Slack messages: finds venues, and files booking requests for linked senders.",
    enabled: true,
    tools: ["searchVenues"],
    temperature: 0.2,
    maxSteps: 4,
  },
  {
    id: "venue-sourcer",
    name: "Venue sourcer",
    description: "Shortlists catalogue venues for an event brief.",
    enabled: true,
    tools: ["searchVenues"],
    temperature: 0.2,
    maxSteps: 3,
  },
  {
    id: "metrics-reporter",
    name: "Metrics reporter",
    description: "Summarises bookings, GBV and commission for operations.",
    enabled: false,
    tools: ["getPlatformMetrics"],
    temperature: 0,
    maxSteps: 2,
  },
];

/** A successful run within this window counts as "active". */
const ACTIVE_WINDOW_MS = 10 * 60_000;

const g = globalThis as typeof globalThis & { __luferAgents?: Map<AgentId, AgentRecord> };
const agents = (g.__luferAgents ??= new Map());
// Backfill defaults (also covers agents added since this process started).
for (const a of DEFAULTS) if (!agents.has(a.id)) agents.set(a.id, { ...a, lastRun: null, runCount: 0 });

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

export function recordRun(id: AgentId, run: AgentRun) {
  const a = agents.get(id);
  if (!a) return;
  a.lastRun = run;
  a.runCount += 1;
}

export function agentStatus(a: AgentRecord, now = Date.now()): AgentStatus {
  if (!a.enabled) return "disabled";
  if (a.lastRun && !a.lastRun.ok) return "error";
  if (a.lastRun && now - new Date(a.lastRun.at).getTime() < ACTIVE_WINDOW_MS) return "active";
  return "idle";
}

/** All agents with their derived status, as of one instant. */
export function agentSnapshot() {
  const now = Date.now();
  return { now, agents: listAgents().map((agent) => ({ agent, status: agentStatus(agent, now) })) };
}
