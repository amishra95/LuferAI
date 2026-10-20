import "server-only";

import { AGENT_TOOLS, DEFAULT_BACKEND, isModelBackend, type AGENT_IDS, type AgentToolName } from "@/lib/agents/config";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import { agentRunStats, logAgentRun, type NewRun } from "@/lib/telemetry/runs";
import type { AgentConfig, AgentId, AgentRecord, AgentStatus } from "@/types/agents";
import type { ChatToolName } from "@/types/chat";

// lib/agents/config.ts lists the tools without importing app types; keep the two lists identical.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const listsMatch: [Same<AgentToolName, ChatToolName>, Same<(typeof AGENT_IDS)[number], AgentId>] = [true, true];
void listsMatch;

/**
 * Agent configs: persisted in Supabase (agent_configurations, migration 0024)
 * and cached in server memory on globalThis, so getAgent() stays synchronous.
 * syncAgentConfigs() refreshes the cache at most every SYNC_TTL_MS (call it
 * before reading in a request); saves write through. Without Supabase, or
 * before the migration is applied, the cache is the only copy: it survives hot
 * reloads, resets on restart, and is per-instance when deployed. Run history
 * (counts, last run, the Overview metrics) is recorded in Upstash Redis by
 * lib/telemetry/runs.ts.
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
    model: DEFAULT_BACKEND,
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
    model: DEFAULT_BACKEND,
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
    model: DEFAULT_BACKEND,
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
    model: DEFAULT_BACKEND,
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
  else {
    agents.get(a.id)!.instructions ??= "";
    agents.get(a.id)!.model ??= a.model;
  }
}

/** How long a read trusts the cache before re-reading Supabase (saves on other instances show up within this). */
const SYNC_TTL_MS = 15_000;
/** "Table doesn't exist" (Postgres, and PostgREST's schema cache): migration 0024 isn't applied here yet. */
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

type Sync = { at: number; pending: Promise<void> | null; store: "supabase" | "memory"; warned: boolean };
const sync: Sync = ((g as typeof g & { __luferAgentSync?: Sync }).__luferAgentSync ??= { at: 0, pending: null, store: "memory", warned: false });

/** Where settings are kept right now, for the /agents badge. */
export const settingsStore = () => sync.store;

function warnOnce(message: string, err: unknown) {
  if (!sync.warned) console.error(message, err);
  sync.warned = true;
}

/** Refreshes the cache from agent_configurations (at most every SYNC_TTL_MS unless forced). Never throws. */
export function syncAgentConfigs(force = false): Promise<void> {
  if (!isSupabaseConfigured()) return Promise.resolve();
  if (!force && Date.now() - sync.at < SYNC_TTL_MS) return Promise.resolve();
  return (sync.pending ??= (async () => {
    try {
      const { data, error } = await createAdminClient().from("agent_configurations").select("*");
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      for (const row of data) {
        const a = agents.get(row.agent_key as AgentId);
        if (!a) continue;
        a.enabled = row.enabled;
        a.instructions = row.system_prompt;
        a.temperature = row.temperature === null ? null : Number(row.temperature);
        a.maxSteps = row.max_steps;
        if (isModelBackend(row.model_backend)) a.model = row.model_backend;
        const tools = row.tools.filter((t): t is AgentToolName => (AGENT_TOOLS as readonly string[]).includes(t));
        if (tools.length) a.tools = tools;
      }
      sync.store = "supabase";
    } catch (err) {
      sync.store = "memory";
      warnOnce("agents: could not read agent_configurations; using in-memory settings", err);
    } finally {
      sync.at = Date.now();
      sync.pending = null;
    }
  })());
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

/**
 * Saves a change: written to agent_configurations first, then to the cache, so
 * a failed write changes nothing. Before migration 0024 is applied (or without
 * Supabase) only the cache changes.
 */
export async function updateAgent(id: AgentId, patch: Partial<Omit<AgentConfig, "id" | "name" | "description">>, updatedBy?: string): Promise<AgentRecord> {
  const a = agents.get(id);
  if (!a) throw new Error(`Unknown agent ${id}`);
  const next = { ...a, ...patch };
  if (isSupabaseConfigured()) {
    const { error } = await createAdminClient()
      .from("agent_configurations")
      .upsert(
        {
          agent_key: id,
          system_prompt: next.instructions,
          temperature: next.temperature,
          model_backend: next.model,
          enabled: next.enabled,
          tools: next.tools,
          max_steps: next.maxSteps,
          updated_by: updatedBy ?? null,
        },
        { onConflict: "agent_key" }
      );
    if (error && MISSING_TABLE.has(error.code)) {
      sync.store = "memory";
      warnOnce("agents: agent_configurations is missing (apply migration 0024); saving in memory only", error.message);
    } else if (error) {
      throw new Error(`Couldn't save ${a.name}: ${error.message}`);
    } else {
      sync.store = "supabase";
    }
  }
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
  await syncAgentConfigs();
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
