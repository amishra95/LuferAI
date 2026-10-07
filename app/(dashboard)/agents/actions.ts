"use server";

import { requireWorkspace } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";

import { getAgent, isAgentId, recordRun, updateAgent } from "@/lib/agents/store";
import { searchVenueCatalogue } from "@/lib/ai/chat-tools";
import { runBudgetForecast, runSpendAnalysis } from "@/lib/analytics/service";
import { computePlatformMetrics, listBookings } from "@/lib/data";
import type { AgentTestResult } from "@/types/agents";
import type { ChatToolName } from "@/types/chat";

const TOOL_NAMES: ChatToolName[] = ["searchVenues", "getPlatformMetrics", "analyzeSpend", "forecastBudget"];

export type AgentConfigState = { status: "idle" | "success" | "error"; message?: string };

export async function setAgentEnabled(id: string, enabled: boolean): Promise<void> {
  await requireWorkspace("/agents");
  if (!isAgentId(id)) throw new Error("Unknown agent.");
  updateAgent(id, { enabled });
  revalidatePath("/agents");
}

export async function saveAgentConfig(_prev: AgentConfigState, form: FormData): Promise<AgentConfigState> {
  await requireWorkspace("/agents");
  const id = String(form.get("id"));
  if (!isAgentId(id)) return { status: "error", message: "Unknown agent." };

  const tools = form.getAll("tools").map(String).filter((t): t is ChatToolName => TOOL_NAMES.includes(t as ChatToolName));
  if (tools.length === 0) return { status: "error", message: "Assign at least one tool." };

  const rawTemp = String(form.get("temperature") ?? "").trim();
  const temperature = rawTemp === "" ? null : Number(rawTemp);
  if (temperature !== null && !(temperature >= 0 && temperature <= 2)) {
    return { status: "error", message: "Temperature must be between 0 and 2, or blank for the model default." };
  }

  const maxSteps = Number(form.get("maxSteps"));
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 10) {
    return { status: "error", message: "Max steps must be a whole number from 1 to 10." };
  }

  updateAgent(id, { tools, temperature, maxSteps });
  revalidatePath("/agents");
  return { status: "success", message: "Saved." };
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

/** Runs each of the agent's tools once with a fixed sample input. Does not call the model. */
export async function runAgentTest(id: string): Promise<AgentTestResult> {
  await requireWorkspace("/agents");
  if (!isAgentId(id)) throw new Error("Unknown agent.");
  const agent = getAgent(id)!;
  const started = performance.now();

  const tools = await Promise.all(
    agent.tools.map(async (name) => {
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
  recordRun(id, {
    at: new Date().toISOString(),
    ok: result.ok,
    durationMs: result.durationMs,
    source: "test",
    error: tools.find((t) => !t.ok)?.summary,
  });
  revalidatePath("/agents");
  return result;
}
