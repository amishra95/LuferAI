"use server";

import { refresh, revalidatePath } from "next/cache";

import { validateAgentPatch, type AgentPatch } from "@/lib/agents/config";
import { getAgent, isAgentId, recordRun, updateAgent } from "@/lib/agents/store";
import { searchVenueCatalogue } from "@/lib/ai/chat-tools";
import { runBudgetForecast, runSpendAnalysis } from "@/lib/analytics/service";
import { requireWorkspace } from "@/lib/auth/session";
import { computePlatformMetrics, listBookings } from "@/lib/data";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { publishAgentConfig } from "@/lib/telemetry/live";
import type { AgentConfigField } from "@/lib/telemetry/events";
import type { AgentRecord, AgentTestResult } from "@/types/agents";
import type { ChatToolName } from "@/types/chat";

/**
 * Agent mutations. Each returns an ActionResult (lib/mutations/dispatch.ts) so
 * the optimistic UI can roll back with the reason, publishes a telemetry event
 * on success so every open view hears about it, and refreshes the caller's
 * current page (it may be the inspector or ⌘K on any route).
 */

/** Pages showing agent settings or runs. */
function revalidateAgentViews() {
  revalidatePath("/agents");
  revalidatePath("/admin/analytics");
  refresh();
}

/** Enable/disable, tools, temperature, max steps and instructions. Only the fields given change. */
export async function updateAgentConfig(id: string, input: AgentPatch): Promise<ActionResult<AgentRecord>> {
  let changed: AgentConfigField[] = [];
  return serverDispatch(
    "agents/updateAgentConfig",
    async () => {
      await requireWorkspace("/agents");
      if (!isAgentId(id)) throw new ActionError("Unknown agent.");
      const result = validateAgentPatch(id, input);
      if (!result.ok) throw new ActionError(result.error);
      changed = Object.keys(result.patch) as AgentConfigField[];
      const agent = updateAgent(id, result.patch);
      revalidateAgentViews();
      return agent;
    },
    { emit: (agent) => publishAgentConfig(agent.id, agent.enabled, changed) }
  );
}

/** Sample input per tool, so a test run exercises the real data path without a model. */
const TOOL_PROBES: Record<ChatToolName, () => Promise<string>> = {
  searchVenues: async () => {
    const r = await searchVenueCatalogue({ location: "", minCapacity: 20, maxBudgetPerHead: 0, features: [] });
    return `${r.total} venues hold 20+ guests`;
  },
  getPlatformMetrics: async () => {
    const m = computePlatformMetrics(await listBookings());
    return `${m.totalBookings} bookings, ${m.pendingBookings} pending`;
  },
  // Agent tests run as an admin, so they use the platform scope.
  analyzeSpend: async () => {
    const r = await runSpendAnalysis({ kind: "platform" }, { period: "fytd", groupBy: "month" });
    if ("error" in r) throw new Error(r.error);
    return `${r.totals.bookings} bookings in ${r.period.label}`;
  },
  forecastBudget: async () => {
    const r = await runBudgetForecast({ kind: "platform" }, { horizonMonths: 3 });
    if ("error" in r) throw new Error(r.error);
    return `${r.forecast.length}-month forecast, ${r.basis.split(",")[0]}`;
  },
};

/**
 * Runs each of the agent's tools once with a fixed sample input (no model call).
 * The run is logged, which publishes a `run` telemetry event. A test whose tools
 * fail still succeeds as a dispatch: the failures are in the result.
 */
export async function runAgentTest(id: string): Promise<ActionResult<AgentTestResult>> {
  return serverDispatch("agents/runAgentTest", async () => {
    await requireWorkspace("/agents");
    if (!isAgentId(id)) throw new ActionError("Unknown agent.");
    const agent = getAgent(id)!;
    if (!agent.enabled) throw new ActionError(`${agent.name} is disabled. Enable it to run a test.`);
    const started = performance.now();

    const tools = await Promise.all(
      agent.tools.map(async (name: ChatToolName) => {
        const t0 = performance.now();
        try {
          const summary = await TOOL_PROBES[name]();
          return { name, ok: true, durationMs: Math.round(performance.now() - t0), summary };
        } catch (err) {
          console.error(`agent test: ${name} failed`, err);
          return { name, ok: false, durationMs: Math.round(performance.now() - t0), summary: err instanceof Error ? err.message : "Failed" };
        }
      })
    );

    const result: AgentTestResult = { ok: tools.every((t) => t.ok), durationMs: Math.round(performance.now() - started), tools };
    await recordRun(id, {
      at: new Date().toISOString(),
      ok: result.ok,
      durationMs: result.durationMs,
      source: "test",
      error: tools.find((t) => !t.ok)?.summary,
    });
    revalidateAgentViews();
    return result;
  });
}
