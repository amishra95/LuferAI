import "server-only";

import { after } from "next/server";

import { summarizeSpend, type SpendSummary, type UsageLog } from "@/lib/agents/spend";
import { costOf } from "@/lib/ai/pricing";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";

/**
 * Token usage per model call (agent_execution_logs), written by the usage
 * middleware in lib/ai/model.ts. Rows go to Supabase when it's configured;
 * process memory always keeps the latest few thousand too, so the /agents
 * dashboard still works locally and when the table isn't migrated yet.
 */

const MEMORY_LIMIT = 5000;
const WINDOW_MS = 30 * 24 * 3_600_000;
/** Rows read for the dashboard: enough for 30 days of a busy workspace. */
const READ_LIMIT = 10_000;

const g = globalThis as typeof globalThis & { __luferUsage?: UsageLog[]; __luferUsageWarned?: boolean };
const memory = (g.__luferUsage ??= []);

export interface UsageEntry {
  agentKey: string;
  model: string;
  source: string;
  promptTokens: number;
  completionTokens: number;
}

/** Records one model call. Never throws: telemetry must not fail the request. */
export function logUsage(entry: UsageEntry): Promise<void> {
  const log: UsageLog = {
    ...entry,
    promptTokens: Math.max(0, Math.round(entry.promptTokens)),
    completionTokens: Math.max(0, Math.round(entry.completionTokens)),
    cost: costOf(entry.model, entry.promptTokens, entry.completionTokens),
    executedAt: new Date().toISOString(),
  };
  memory.unshift(log);
  if (memory.length > MEMORY_LIMIT) memory.length = MEMORY_LIMIT;

  const p = write(log).catch((err) => {
    // Most likely the 0024 migration isn't applied yet; say so once, keep the memory copy.
    if (!g.__luferUsageWarned) console.error("telemetry: could not store token usage (is migration 0024 applied?)", err);
    g.__luferUsageWarned = true;
  });
  try {
    after(p);
  } catch {
    // Outside a request (tests, scripts): the promise still runs.
  }
  return p;
}

async function write(log: UsageLog) {
  if (!isSupabaseConfigured()) return;
  const { error } = await createAdminClient().from("agent_execution_logs").insert({
    agent_key: log.agentKey,
    model: log.model,
    source: log.source,
    prompt_tokens: log.promptTokens,
    completion_tokens: log.completionTokens,
    cost: log.cost,
    executed_at: log.executedAt,
  });
  if (error) throw new Error(error.message);
}

/** The last 30 days of calls, newest first: from Supabase when it answers, else this instance's memory. */
export async function listUsage(now = Date.now()): Promise<{ logs: UsageLog[]; source: "supabase" | "memory" }> {
  const since = new Date(now - WINDOW_MS).toISOString();
  if (isSupabaseConfigured()) {
    const { data, error } = await createAdminClient()
      .from("agent_execution_logs")
      .select("agent_key, model, source, prompt_tokens, completion_tokens, cost, executed_at")
      .gte("executed_at", since)
      .order("executed_at", { ascending: false })
      .limit(READ_LIMIT);
    if (!error && data) {
      return {
        source: "supabase",
        logs: data.map((r) => ({
          agentKey: r.agent_key,
          model: r.model,
          source: r.source,
          promptTokens: r.prompt_tokens,
          completionTokens: r.completion_tokens,
          cost: r.cost === null ? null : Number(r.cost),
          executedAt: r.executed_at,
        })),
      };
    }
    if (error && !g.__luferUsageWarned) console.error("telemetry: could not read token usage (is migration 0024 applied?); showing this instance's", error.message);
    if (error) g.__luferUsageWarned = true;
  }
  return { source: "memory", logs: memory.filter((l) => l.executedAt >= since) };
}

export async function spendSnapshot(now = Date.now()): Promise<{ summary: SpendSummary; source: "supabase" | "memory" }> {
  const { logs, source } = await listUsage(now);
  return { summary: summarizeSpend(logs, now), source };
}
