"use client";

import { useState } from "react";
import { Check, Loader2, Play, SlidersHorizontal, X } from "lucide-react";

import { AgentSettingsSheet, type BackendOption } from "@/components/agents/agent-settings-sheet";
import { useAgentMutations } from "@/components/agents/use-agent-mutations";
import { Switch } from "@/components/dashboard/switch";
import { InspectButton } from "@/components/workspace/inspect";
import { MODEL_BACKEND_LABEL } from "@/lib/agents/config";
import { cn } from "@/lib/utils";
import type { AgentRecord, AgentStatus, AgentTestResult } from "@/types/agents";

/** Shared column template so the header and every row line up. */
export const AGENT_GRID = "lg:grid lg:grid-cols-[minmax(0,1.5fr)_6.5rem_minmax(0,1.3fr)_5.5rem_3.5rem_3.5rem_3.5rem_11rem] lg:items-center lg:gap-4";

function formatAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  switch (status) {
    case "active":
      return (
        <span className="pill">
          <span className="status-dot bg-sage" aria-hidden /> active
        </span>
      );
    case "idle":
      return (
        <span className="pill">
          <span className="bg-fg-subtle size-1.5 rounded-full" aria-hidden /> idle
        </span>
      );
    case "error":
      return (
        <span className="pill border-rose/25 bg-rose/[0.06] text-rose">
          <X className="size-2.5" strokeWidth={3} aria-hidden /> error
        </span>
      );
    case "disabled":
      return (
        <span className="pill text-fg-subtle">
          <span className="border-fg-faint size-1.5 rounded-full border" aria-hidden /> off
        </span>
      );
  }
}

/** Mobile-only inline label for a value that has a column header on desktop. */
function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline gap-2 lg:block", className)}>
      <span className="label-mono lg:hidden">{label}</span>
      {children}
    </div>
  );
}

/** Status as it should look while an enable/disable is in flight. */
export function displayStatus(agent: Pick<AgentRecord, "enabled">, serverStatus: AgentStatus): AgentStatus {
  if (!agent.enabled) return "disabled";
  return serverStatus === "disabled" ? "idle" : serverStatus;
}

export function AgentRow({ agent: serverAgent, status: serverStatus, now, backends }: { agent: AgentRecord; status: AgentStatus; now: number; backends: BackendOption[] }) {
  const { agent, save, setEnabled, saving, runTest, testing } = useAgentMutations(serverAgent);
  const [test, setTest] = useState<AgentTestResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const status = displayStatus(agent, serverStatus);

  async function startTest() {
    const outcome = await runTest();
    if (outcome?.ok) setTest(outcome.result);
  }

  const lastError = agent.lastRun && !agent.lastRun.ok ? agent.lastRun.error : null;

  return (
    <li className="border-line border-b last:border-b-0">
      <div className={cn("hover:bg-surface-hover flex flex-col gap-3 px-5 py-4 transition-colors", AGENT_GRID)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <p className="text-fg min-w-0 truncate text-[13.5px] font-medium">
              <InspectButton kind="agent" id={agent.id} label={agent.name} className="block truncate">
                {agent.name}
              </InspectButton>
            </p>
            <span className="border-line text-fg-subtle shrink-0 rounded border px-1.5 py-px font-mono text-[10.5px]" title={`Model backend: ${agent.model}`}>
              {MODEL_BACKEND_LABEL[agent.model]}
            </span>
            <span className="lg:hidden">
              <AgentStatusBadge status={status} />
            </span>
          </div>
          <p className="text-fg-subtle mt-0.5 truncate text-[12.5px]" title={agent.description}>
            {agent.description}
          </p>
          {agent.instructions && (
            <p className="text-fg-faint mt-0.5 truncate font-mono text-[11px]" title={agent.instructions}>
              + {agent.instructions}
            </p>
          )}
          {lastError && <p className="text-rose/90 mt-1 truncate font-mono text-[11px]" title={lastError}>{lastError}</p>}
        </div>

        <div className="hidden lg:block">
          <AgentStatusBadge status={status} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {agent.tools.map((t) => (
            <span key={t} className="border-line bg-surface text-fg-muted rounded-md border px-1.5 py-0.5 font-mono text-[11px]">
              {t}
            </span>
          ))}
        </div>

        <div className="text-fg-muted flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12px] tabular-nums lg:contents">
          <Cell label="last">{agent.lastRun ? formatAgo(agent.lastRun.at, now) : <span className="text-fg-subtle">never</span>}</Cell>
          <Cell label="runs" className="lg:text-right">{agent.runCount}</Cell>
          <Cell label="steps" className="lg:text-right">{agent.maxSteps}</Cell>
          <Cell label="temp" className="lg:text-right">{agent.temperature ?? <span className="text-fg-subtle">auto</span>}</Cell>
        </div>

        <div className="flex items-center gap-1.5 lg:justify-end">
          <Switch on={agent.enabled} label={`${agent.enabled ? "Disable" : "Enable"} ${agent.name}`} pending={saving} onToggle={() => void setEnabled(!agent.enabled)} />
          <span className="bg-line mx-1.5 h-4 w-px" aria-hidden />
          <button
            type="button"
            onClick={startTest}
            disabled={testing || !agent.enabled}
            title={agent.enabled ? "Run each assigned tool once with a sample input" : "Enable the agent to run a test"}
            className="btn h-7 px-2.5 text-[12px]"
          >
            {testing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Play className="size-3" aria-hidden />}
            Test
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={`Configure ${agent.name}`}
            title="Settings"
            className="btn btn-icon size-7"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {test && (
        <div className="px-5 pb-4" aria-live="polite">
          <TestResult result={test} onDismiss={() => setTest(null)} />
        </div>
      )}

      <AgentSettingsSheet
        agent={agent}
        backends={backends}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSave={(patch) => save(patch, { failure: `Couldn't save ${agent.name}`, success: `Saved ${agent.name}` })}
      />
    </li>
  );
}

export function TestResult({ result, onDismiss }: { result: AgentTestResult; onDismiss?: () => void }) {
  return (
    <div className="border-line rounded-lg border bg-surface-hover px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label-mono">
          test run<span className="text-fg-muted normal-case"> · {result.durationMs} ms</span>
        </span>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="Dismiss test result" className="btn btn-ghost btn-icon size-6">
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {result.tools.map((t) => (
          <li key={t.name} className="flex items-center gap-2.5 font-mono text-[12px]">
            {t.ok ? <Check className="text-sage size-3.5" strokeWidth={2.5} aria-label="passed" /> : <X className="text-rose size-3.5" strokeWidth={2.5} aria-label="failed" />}
            <span className="text-fg">{t.name}</span>
            <span className="text-fg-subtle truncate font-sans text-[12.5px]">{t.summary}</span>
            <span className="text-fg-subtle ml-auto tabular-nums">{t.durationMs} ms</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
