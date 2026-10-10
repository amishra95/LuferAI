"use client";

import { useRef, useState } from "react";
import { Check, Loader2, Play, SlidersHorizontal, X } from "lucide-react";

import { useAgentMutations } from "@/components/agents/use-agent-mutations";
import { TOOL_META } from "@/components/chat/tool-meta";
import { Switch } from "@/components/dashboard/switch";
import { InspectButton } from "@/components/workspace/inspect";
import { agentPatchFromForm, isPromptable, MAX_INSTRUCTIONS, type AgentPatch } from "@/lib/agents/config";
import { cn } from "@/lib/utils";
import type { AgentRecord, AgentStatus, AgentTestResult } from "@/types/agents";
import type { ChatToolName } from "@/types/chat";

const ALL_TOOLS = Object.keys(TOOL_META) as ChatToolName[];

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

export function AgentRow({ agent: serverAgent, status: serverStatus, now }: { agent: AgentRecord; status: AgentStatus; now: number }) {
  const { agent, save, setEnabled, saving, runTest, testing } = useAgentMutations(serverAgent);
  const [test, setTest] = useState<AgentTestResult | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
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
            onClick={() => dialog.current?.showModal()}
            aria-label={`Configure ${agent.name}`}
            title="Configure"
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

      <ConfigDialog ref={dialog} agent={agent} onSave={(patch) => save(patch, { failure: `Couldn't save ${agent.name}`, success: `Saved ${agent.name}` })} />
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

/**
 * Tools, temperature, steps and (for agents whose prompt the app builds)
 * operator instructions. Validated here with the server's rules, so a save
 * closes the dialog and shows at once; a server failure rolls back with a toast.
 */
function ConfigDialog({ agent, onSave, ref }: { agent: AgentRecord; onSave: (patch: AgentPatch) => void; ref: React.RefObject<HTMLDialogElement | null> }) {
  const [error, setError] = useState<string | null>(null);
  const promptable = isPromptable(agent.id);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = agentPatchFromForm(agent.id, {
      tools: form.getAll("tools").map(String),
      temperature: String(form.get("temperature") ?? ""),
      maxSteps: String(form.get("maxSteps") ?? ""),
      ...(promptable && { instructions: String(form.get("instructions") ?? "") }),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    ref.current?.close();
    onSave(result.patch);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${agent.id}-config`}
      onClose={() => setError(null)}
      className="border-line bg-elevated text-fg m-auto w-[min(30rem,calc(100vw-2rem))] rounded-lg border p-0 backdrop:bg-black/60"
    >
      {/* key resets the uncontrolled inputs to the current values each time the agent changes. */}
      <form onSubmit={submit} key={`${agent.tools.join()}|${agent.temperature}|${agent.maxSteps}|${agent.instructions}`}>
        <header className="flex items-start justify-between px-6 pt-5 pb-1">
          <div>
            <h2 id={`${agent.id}-config`} className="text-[15px] font-semibold tracking-[-0.01em]">
              {agent.name}
            </h2>
            <p className="text-fg-subtle mt-0.5 font-mono text-[11px]">{agent.id}</p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="btn btn-ghost btn-icon -mr-2 size-8">
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-6 px-6 py-5">
          <fieldset>
            <legend className="label-mono mb-2.5">Tools</legend>
            <div className="space-y-2">
              {ALL_TOOLS.map((t, i) => (
                <label
                  key={t}
                  className="border-line hover:border-line-strong has-checked:border-fg/40 has-checked:bg-fg/[0.06] flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors"
                >
                  <input type="checkbox" name="tools" value={t} defaultChecked={agent.tools.includes(t)} autoFocus={i === 0} className="accent-fg mt-0.5 size-3.5" />
                  <span>
                    <span className="text-fg block font-mono text-[12px]">{t}</span>
                    <span className="text-fg-subtle mt-0.5 block text-[12.5px]">{TOOL_META[t].summary}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label-mono mb-2 block">Temperature</span>
              <input name="temperature" type="number" min={0} max={2} step={0.1} placeholder="auto" defaultValue={agent.temperature ?? ""} className="field font-mono" />
            </label>
            <label className="block">
              <span className="label-mono mb-2 block">Max steps</span>
              <input name="maxSteps" type="number" min={1} max={10} step={1} required defaultValue={agent.maxSteps} className="field font-mono" />
            </label>
          </div>

          {promptable && (
            <label className="block">
              <span className="label-mono mb-2 block">Instructions</span>
              <textarea
                name="instructions"
                rows={4}
                maxLength={MAX_INSTRUCTIONS}
                defaultValue={agent.instructions}
                placeholder="Optional. Added to the system prompt, e.g. “Prefer venues in Indiranagar.”"
                className="field h-auto resize-y py-2 text-[12.5px] leading-5"
              />
            </label>
          )}
          {agent.id === "workspace-agent" && (
            <p className="text-fg-subtle text-[12.5px]">Applies to the next message sent in Chat. Leave temperature blank for the model default.</p>
          )}
          {error && (
            <p role="alert" className="text-rose text-[12.5px]">
              {error}
            </p>
          )}
        </div>

        <footer className="border-line flex justify-end gap-2 border-t px-6 py-4">
          <button type="button" onClick={() => ref.current?.close()} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save changes
          </button>
        </footer>
      </form>
    </dialog>
  );
}
