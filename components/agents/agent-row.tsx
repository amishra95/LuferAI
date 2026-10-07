"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Check, Loader2, Play, SlidersHorizontal, X } from "lucide-react";

import { runAgentTest, saveAgentConfig, setAgentEnabled, type AgentConfigState } from "@/app/(dashboard)/agents/actions";
import { TOOL_META } from "@/components/chat/tool-meta";
import { submitWithoutReset } from "@/lib/form-submit";
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
        <span className="pill pill-copper">
          <span className="live-dot" aria-hidden /> active
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
        <span className="pill text-fg-faint">
          <span className="border-fg-faint size-1.5 rounded-full border" aria-hidden /> off
        </span>
      );
  }
}

function Switch({ on, label, pending, onToggle }: { on: boolean; label: string; pending: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={pending}
      onClick={onToggle}
      className={cn(
        "relative h-[18px] w-8 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        on ? "border-copper/40 bg-copper/25" : "border-line-strong bg-surface-raised"
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] size-3 rounded-full transition-all duration-200",
          on ? "bg-copper translate-x-[14px] shadow-[0_0_8px_rgb(245_158_11/0.6)]" : "bg-fg-subtle"
        )}
      />
    </button>
  );
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

export function AgentRow({ agent, status, now }: { agent: AgentRecord; status: AgentStatus; now: number }) {
  const [toggling, startToggle] = useTransition();
  const [testing, startTest] = useTransition();
  const [test, setTest] = useState<AgentTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  function runTest() {
    setTestError(null);
    startTest(async () => {
      try {
        setTest(await runAgentTest(agent.id));
      } catch {
        setTest(null);
        setTestError("Test run failed to start.");
      }
    });
  }

  const lastError = agent.lastRun && !agent.lastRun.ok ? agent.lastRun.error : null;

  return (
    <li className="border-line border-b last:border-b-0">
      <div className={cn("hover:bg-surface flex flex-col gap-3 px-5 py-4 transition-colors", AGENT_GRID)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <p className="text-fg truncate text-[13.5px] font-medium">{agent.name}</p>
            <span className="lg:hidden">
              <AgentStatusBadge status={status} />
            </span>
          </div>
          <p className="text-fg-subtle mt-0.5 truncate text-[12.5px]" title={agent.description}>
            {agent.description}
          </p>
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
          <Cell label="last">{agent.lastRun ? formatAgo(agent.lastRun.at, now) : <span className="text-fg-faint">never</span>}</Cell>
          <Cell label="runs" className="lg:text-right">{agent.runCount}</Cell>
          <Cell label="steps" className="lg:text-right">{agent.maxSteps}</Cell>
          <Cell label="temp" className="lg:text-right">{agent.temperature ?? <span className="text-fg-faint">auto</span>}</Cell>
        </div>

        <div className="flex items-center gap-1.5 lg:justify-end">
          <Switch
            on={agent.enabled}
            label={`${agent.enabled ? "Disable" : "Enable"} ${agent.name}`}
            pending={toggling}
            onToggle={() => startToggle(() => setAgentEnabled(agent.id, !agent.enabled))}
          />
          <span className="bg-line mx-1.5 h-4 w-px" aria-hidden />
          <button
            type="button"
            onClick={runTest}
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

      {(test || testError) && (
        <div className="px-5 pb-4" aria-live="polite">
          <div className="border-line rounded-xl border bg-black/25 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="label-mono">
                test run{test && <span className="text-fg-muted normal-case"> · {test.durationMs} ms</span>}
              </span>
              <button
                type="button"
                onClick={() => {
                  setTest(null);
                  setTestError(null);
                }}
                aria-label="Dismiss test result"
                className="btn btn-ghost btn-icon size-6"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
            {testError && <p className="text-rose text-[12.5px]">{testError}</p>}
            <ul className="space-y-1.5">
              {test?.tools.map((t) => (
                <li key={t.name} className="flex items-center gap-2.5 font-mono text-[12px]">
                  {t.ok ? <Check className="text-sage size-3.5" strokeWidth={2.5} aria-label="passed" /> : <X className="text-rose size-3.5" strokeWidth={2.5} aria-label="failed" />}
                  <span className="text-fg">{t.name}</span>
                  <span className="text-fg-subtle truncate font-sans text-[12.5px]">{t.summary}</span>
                  <span className="text-fg-faint ml-auto tabular-nums">{t.durationMs} ms</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ConfigDialog ref={dialog} agent={agent} />
    </li>
  );
}

function ConfigDialog({ agent, ref }: { agent: AgentRecord; ref: React.RefObject<HTMLDialogElement | null> }) {
  const [state, action, pending] = useActionState(
    async (prev: AgentConfigState, form: FormData) => {
      const result = await saveAgentConfig(prev, form);
      if (result.status === "success") ref.current?.close();
      return result;
    },
    { status: "idle" }
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${agent.id}-config`}
      className="border-line-strong bg-obsidian-raised text-fg m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border p-0 shadow-2xl shadow-black/70 backdrop:bg-black/60 backdrop:backdrop-blur-[2px]"
    >
      {/* key resets the uncontrolled inputs to the saved values each time the agent changes. */}
      <form onSubmit={submitWithoutReset(action)} key={`${agent.tools.join()}|${agent.temperature}|${agent.maxSteps}`}>
        <input type="hidden" name="id" value={agent.id} />
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
                  className="border-line hover:border-line-strong has-checked:border-copper/35 has-checked:bg-copper/[0.04] flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors"
                >
                  <input
                    type="checkbox"
                    name="tools"
                    value={t}
                    defaultChecked={agent.tools.includes(t)}
                    autoFocus={i === 0}
                    className="accent-copper mt-0.5 size-3.5"
                  />
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
          {agent.id === "workspace-agent" && (
            <p className="text-fg-subtle text-[12.5px]">Applies to the next message sent in Chat. Leave temperature blank for the model default.</p>
          )}
          {state.status === "error" && (
            <p role="alert" className="text-rose text-[12.5px]">
              {state.message}
            </p>
          )}
        </div>

        <footer className="border-line flex justify-end gap-2 border-t px-6 py-4">
          <button type="button" onClick={() => ref.current?.close()} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Save changes
          </button>
        </footer>
      </form>
    </dialog>
  );
}
