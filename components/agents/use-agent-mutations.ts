"use client";

import { useCallback } from "react";

import { runAgentTest, updateAgentConfig } from "@/app/(dashboard)/agents/actions";
import { useAction, useOptimisticMutation } from "@/components/workspace/use-optimistic-mutation";
import { applyAgentPatch, type AgentPatch } from "@/lib/agents/config";
import type { AgentRecord, AgentTestResult } from "@/types/agents";

/**
 * Agent mutations shared by the /agents table, the inspector and ⌘K: the
 * agent as it should look right now (optimistic), plus enable/disable, config
 * saves and test dispatches. Failures roll back and toast the server's reason.
 */
export function useAgentMutations(serverAgent: AgentRecord) {
  const { value: agent, mutate, pending: saving } = useOptimisticMutation(serverAgent);
  const test = useAction<AgentTestResult>();

  const save = useCallback(
    (patch: AgentPatch, labels: { failure: string; success?: string }) =>
      mutate({
        apply: (a) => applyAgentPatch(a, patch),
        action: () => updateAgentConfig(serverAgent.id, patch),
        // The server's config wins (it normalises values); run stats stay as rendered,
        // since the saved record only has this instance's counts.
        commit: (base, saved) => ({ ...base, enabled: saved.enabled, tools: saved.tools, temperature: saved.temperature, maxSteps: saved.maxSteps, instructions: saved.instructions }),
        failure: labels.failure,
        success: labels.success ? () => ({ tone: "success", title: labels.success! }) : undefined,
      }),
    [mutate, serverAgent.id]
  );

  const setEnabled = useCallback(
    (enabled: boolean) => save({ enabled }, { failure: `Couldn't ${enabled ? "enable" : "disable"} ${serverAgent.name}` }),
    [save, serverAgent.name]
  );

  const runTest = useCallback(
    () =>
      test.run(() => runAgentTest(serverAgent.id), {
        failure: `Couldn't start a test of ${serverAgent.name}`,
        success: (r) =>
          r.ok
            ? { tone: "success", title: `${serverAgent.name}: test passed`, description: `${r.tools.length} tool${r.tools.length === 1 ? "" : "s"} · ${r.durationMs} ms` }
            : { tone: "error", title: `${serverAgent.name}: test failed`, description: r.tools.filter((t) => !t.ok).map((t) => `${t.name}: ${t.summary}`).join("; ") },
      }),
    [test, serverAgent.id, serverAgent.name]
  );

  return { agent, save, setEnabled, saving, runTest, testing: test.pending };
}
