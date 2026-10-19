"use server";

import { refresh, revalidatePath } from "next/cache";

import { validateAgentPatch, type AgentPatch } from "@/lib/agents/config";
import { getAgent, isAgentId, recordRun, syncAgentConfigs, updateAgent } from "@/lib/agents/store";
import { searchVenueCatalogue } from "@/lib/ai/chat-tools";
import { isPromptKey, validatePromptDraft, type PromptVersion } from "@/lib/ai/prompt-registry";
import { activatePromptVersion, createPromptDraft, deletePromptDraft, PromptRegistryError, revertToBuiltIn, updatePromptDraft } from "@/lib/ai/prompt-store";
import { validatePlatformGuardrails, type PlatformGuardrails } from "@/lib/guardrails/platform";
import { PlatformGuardrailsError, savePlatformGuardrails } from "@/lib/guardrails/platform-store";
import { runBudgetForecast, runSpendAnalysis } from "@/lib/analytics/service";
import { requireWorkspace } from "@/lib/auth/session";
import { computePlatformMetrics, listBookings } from "@/lib/data";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { publishAgentConfig } from "@/lib/telemetry/live";
import type { AgentConfigField } from "@/lib/telemetry/events";
import { tracer } from "@/lib/tracer";
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

/** Enable/disable, tools, temperature, max steps, instructions and model backend. Only the fields given change; saved to agent_configurations. */
export async function updateAgentConfig(id: string, input: AgentPatch): Promise<ActionResult<AgentRecord>> {
  let changed: AgentConfigField[] = [];
  return serverDispatch(
    "agents/updateAgentConfig",
    async () => {
      const member = await requireWorkspace("/agents");
      if (!isAgentId(id)) throw new ActionError("Unknown agent.");
      const result = validateAgentPatch(id, input);
      if (!result.ok) throw new ActionError(result.error);
      changed = Object.keys(result.patch) as AgentConfigField[];
      // Fresh copy first: the upsert writes the whole row.
      await syncAgentConfigs(true);
      const agent = await updateAgent(id, result.patch, member.userId).catch((err: unknown) => {
        throw new ActionError(err instanceof Error ? err.message : "Couldn't save the agent.");
      });
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
    await syncAgentConfigs();
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

// ----------------------------------------------------------------------------
// Prompt registry (lib/ai/prompt-store) and platform guardrails (lib/guardrails/platform-store)
// ----------------------------------------------------------------------------

/** Store refusals carry a message for the admin; anything else is logged by serverDispatch and kept generic. */
const asActionError = (err: unknown): never => {
  if (err instanceof PromptRegistryError || err instanceof PlatformGuardrailsError) throw new ActionError(err.message);
  throw err;
};

/** Creates a draft, or edits one when `id` is given. */
export async function savePromptDraft(key: string, input: { id?: string; body: string; note: string }): Promise<ActionResult<PromptVersion>> {
  return serverDispatch("agents/savePromptDraft", async () => {
    const member = await requireWorkspace("/agents");
    if (!isPromptKey(key)) throw new ActionError("Unknown prompt.");
    const draft = validatePromptDraft(input);
    if (!draft.ok) throw new ActionError(draft.error);
    const version = await (input.id ? updatePromptDraft(input.id, draft.value) : createPromptDraft(key, draft.value, member.userId)).catch(asActionError);
    revalidatePath("/agents");
    return version;
  });
}

export async function deletePromptDraftAction(id: string): Promise<ActionResult<{ id: string }>> {
  return serverDispatch("agents/deletePromptDraft", async () => {
    await requireWorkspace("/agents");
    await deletePromptDraft(id).catch(asActionError);
    revalidatePath("/agents");
    return { id };
  });
}

/** Puts a version live (a draft, or an archived one to roll back). The negotiator uses it from its next session. */
export async function activatePromptAction(id: string): Promise<ActionResult<PromptVersion>> {
  return serverDispatch("agents/activatePrompt", async () => {
    const member = await requireWorkspace("/agents");
    const version = await tracer.trace("prompt.activate", async (span) => {
      const v = await activatePromptVersion(id, member.userId).catch(asActionError);
      span.setAttributes({ prompt: v.promptKey, version: v.version });
      return v;
    });
    revalidatePath("/agents");
    return version;
  });
}

export async function revertPromptAction(key: string): Promise<ActionResult<{ key: string }>> {
  return serverDispatch("agents/revertPrompt", async () => {
    await requireWorkspace("/agents");
    if (!isPromptKey(key)) throw new ActionError("Unknown prompt.");
    await tracer.trace("prompt.activate", async (span) => {
      span.setAttributes({ prompt: key, version: "built-in" });
      await revertToBuiltIn(key).catch(asActionError);
    });
    revalidatePath("/agents");
    return { key };
  });
}

/** Saves the platform ceilings. Applies to new offers, auto rules and negotiator tool calls. */
export async function savePlatformGuardrailsAction(input: Record<string, unknown>): Promise<ActionResult<PlatformGuardrails>> {
  return serverDispatch("agents/savePlatformGuardrails", async () => {
    const member = await requireWorkspace("/agents");
    const parsed = validatePlatformGuardrails(input);
    if (!parsed.ok) throw new ActionError(parsed.error);
    const saved = await tracer.trace("guardrails.platform.save", async (span) => {
      span.setAttributes({ ...parsed.value });
      return savePlatformGuardrails(parsed.value, member.userId).catch(asActionError);
    });
    revalidatePath("/agents");
    revalidatePath("/property");
    return saved.settings;
  });
}
