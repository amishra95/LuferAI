/**
 * Human-readable progress for agent tool calls, shared by workspace chat
 * (/chat), the concierge and live runs on /agents.
 *
 * Pure: tests import it directly (tests/agent-progress.test.mjs).
 */

import type { RunEvent } from "./run-events.ts";

export type ToolKind = "search" | "policy" | "card" | "metrics" | "spend" | "forecast" | "tool";
export type ActivityKind = ToolKind | "thinking" | "writing" | "approval";

export interface ToolProgress {
  kind: ToolKind;
  /** While running, without the trailing ellipsis. */
  running: string;
  done: string;
}

const KNOWN: Record<string, Omit<ToolProgress, "kind"> & { kind: Exclude<ToolKind, "tool"> }> = {};
const add = (names: string[], p: Omit<ToolProgress, "kind"> & { kind: Exclude<ToolKind, "tool"> }) => names.forEach((n) => (KNOWN[n] = p));

add(["searchVenues", "searchProperties", "queryReservationInventory"], { kind: "search", running: "Searching venue availability", done: "Searched venue availability" });
add(["checkPolicy", "validateBudget", "checkSpendPolicy"], { kind: "policy", running: "Verifying department spend policy", done: "Verified department spend policy" });
add(["issueVirtualCard", "createCard", "issueCorporateVirtualCard"], { kind: "card", running: "Issuing sandboxed virtual card", done: "Issued sandboxed virtual card" });
add(["getPlatformMetrics"], { kind: "metrics", running: "Aggregating platform metrics", done: "Aggregated platform metrics" });
add(["analyzeSpend"], { kind: "spend", running: "Analysing spend", done: "Analysed spend" });
add(["forecastBudget"], { kind: "forecast", running: "Forecasting budget", done: "Forecast budget" });

export function toolProgress(name: string): ToolProgress {
  return KNOWN[name] ?? { kind: "tool", running: `Executing ${name}`, done: `Ran ${name}` };
}

export interface AgentActivity {
  kind: ActivityKind;
  label: string;
  /** 1-based step of the current turn, when known. */
  step: number | null;
}

const THINKING: AgentActivity = { kind: "thinking", label: "Thinking", step: null };

/** Minimal shape of an AI SDK UI message part (tool parts are `tool-<name>` or `dynamic-tool`). */
type PartLike = { type: string; state?: string; toolName?: string };

const RUNNING_STATES = new Set(["input-streaming", "input-available", "approval-responded"]);

/** What the agent is doing now, from the parts of the assistant message being streamed. */
export function activityFromParts(parts: readonly PartLike[]): AgentActivity {
  const step = parts.filter((p) => p.type === "step-start").length || null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const name = p.type === "dynamic-tool" ? p.toolName : p.type.startsWith("tool-") ? p.type.slice(5) : null;
    if (name) {
      if (p.state === "approval-requested") return { kind: "approval", label: "Waiting for your approval", step };
      if (p.state && RUNNING_STATES.has(p.state)) {
        const t = toolProgress(name);
        return { kind: t.kind, label: t.running, step };
      }
      // The latest tool finished: the model is deciding what to do with its output.
      return { kind: "thinking", label: "Reviewing results", step };
    }
    if (p.type === "text") return { kind: "writing", label: "Writing the answer", step };
  }
  return { ...THINKING, step };
}

/** The same, from the events of a live run on /agents. */
export function activityFromRunEvents(events: readonly RunEvent[]): AgentActivity {
  const open = new Map<string, string>();
  let step: number | null = null;
  let last: RunEvent | undefined;
  for (const e of events) {
    if ("step" in e) step = e.step;
    if (e.type === "tool_call") open.set(e.toolCallId, e.toolName);
    if (e.type === "tool_response") open.delete(e.toolCallId);
    last = e;
  }
  const running = [...open.values()].at(-1);
  if (running) {
    const t = toolProgress(running);
    return { kind: t.kind, label: t.running, step };
  }
  if (last?.type === "tool_response") return { kind: "thinking", label: "Reviewing results", step };
  if (last?.type === "final_output") return { kind: "writing", label: "Writing the answer", step };
  return { ...THINKING, step };
}
