"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, CircleDot, CirclePause, Loader2, Play, Power, Settings2, X, XCircle, type LucideIcon } from "lucide-react";

import { runAgentTest, saveAgentConfig, setAgentEnabled, type AgentConfigState } from "@/app/(dashboard)/agents/actions";
import { TOOL_META } from "@/components/chat/tool-meta";
import { submitWithoutReset } from "@/lib/form-submit";
import { cn } from "@/lib/utils";
import type { AgentRecord, AgentStatus, AgentTestResult } from "@/types/agents";
import type { ChatToolName } from "@/types/chat";

const STATUS: Record<AgentStatus, { label: string; icon: LucideIcon; className: string }> = {
  active: { label: "Active", icon: CircleDot, className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" },
  idle: { label: "Idle", icon: CirclePause, className: "border-zinc-600/40 bg-zinc-500/10 text-zinc-300" },
  error: { label: "Error", icon: AlertCircle, className: "border-red-500/20 bg-red-500/10 text-red-400" },
  disabled: { label: "Disabled", icon: Power, className: "border-zinc-700 bg-zinc-900 text-zinc-500" },
};

const ALL_TOOLS = Object.keys(TOOL_META) as ChatToolName[];

function formatAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium", className)}>
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function AgentCard({ agent, status, now }: { agent: AgentRecord; status: AgentStatus; now: number }) {
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

  return (
    <article className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-medium text-zinc-50">{agent.name}</h2>
            <AgentStatusBadge status={status} />
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{agent.id}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={agent.enabled}
          aria-label={`${agent.enabled ? "Disable" : "Enable"} ${agent.name}`}
          disabled={toggling}
          onClick={() => startToggle(() => setAgentEnabled(agent.id, !agent.enabled))}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-60",
            agent.enabled ? "border-emerald-500/40 bg-emerald-500/30" : "border-zinc-700 bg-zinc-800"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 size-3.5 rounded-full bg-zinc-100 transition-transform",
              agent.enabled && "translate-x-4"
            )}
          />
        </button>
      </header>

      <p className="px-4 text-sm text-zinc-400">{agent.description}</p>

      <dl className="mt-4 grid grid-cols-3 gap-px border-y border-zinc-800 bg-zinc-800 text-xs">
        {[
          ["Last run", agent.lastRun ? formatAgo(agent.lastRun.at, now) : "Never"],
          ["Runs", agent.runCount.toLocaleString("en-US")],
          ["Max steps", String(agent.maxSteps)],
        ].map(([k, v]) => (
          <div key={k} className="bg-zinc-950 px-4 py-2.5">
            <dt className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">{k}</dt>
            <dd className="mt-0.5 font-mono text-zinc-200 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {agent.tools.map((t) => {
          const Icon = TOOL_META[t].icon;
          return (
            <span key={t} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
              <Icon className="size-3 text-zinc-500" aria-hidden />
              {t}
            </span>
          );
        })}
      </div>

      {agent.lastRun && !agent.lastRun.ok && agent.lastRun.error && (
        <p className="mx-4 mt-3 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 font-mono text-[11px] text-red-300">
          {agent.lastRun.error}
        </p>
      )}

      {(test || testError) && (
        <div className="mx-4 mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-2.5" aria-live="polite">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-zinc-500">
            <span>Test run {test && `· ${test.durationMs} ms`}</span>
            <button type="button" onClick={() => { setTest(null); setTestError(null); }} aria-label="Dismiss test result" className="hover:text-zinc-200">
              <X className="size-3" aria-hidden />
            </button>
          </div>
          {testError && <p className="text-xs text-red-300">{testError}</p>}
          <ul className="space-y-1">
            {test?.tools.map((t) => (
              <li key={t.name} className="flex items-center gap-2 text-xs">
                {t.ok ? <CheckCircle2 className="size-3.5 text-emerald-400" aria-label="Passed" /> : <XCircle className="size-3.5 text-red-400" aria-label="Failed" />}
                <span className="font-mono text-zinc-300">{t.name}</span>
                <span className="truncate text-zinc-500">{t.summary}</span>
                <span className="ml-auto font-mono text-zinc-600 tabular-nums">{t.durationMs} ms</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-auto flex gap-2 p-4 pt-3">
        <button
          type="button"
          onClick={runTest}
          disabled={testing || !agent.enabled}
          title={agent.enabled ? "Run each assigned tool once with a sample input" : "Enable the agent to run a test"}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50"
        >
          {testing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          Test run
        </button>
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
        >
          <Settings2 className="size-3.5" aria-hidden />
          Configure
        </button>
      </footer>

      <ConfigDialog ref={dialog} agent={agent} />
    </article>
  );
}

function ConfigDialog({ agent, ref }: { agent: AgentRecord; ref: React.RefObject<HTMLDialogElement | null> }) {
  const [state, action, pending] = useActionState(async (prev: AgentConfigState, form: FormData) => {
    const result = await saveAgentConfig(prev, form);
    if (result.status === "success") ref.current?.close();
    return result;
  }, { status: "idle" });

  const field = "h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 font-mono text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none";

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${agent.id}-config`}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-zinc-800 bg-zinc-950 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/60"
    >
      {/* key resets the uncontrolled inputs to the saved values each time the agent changes. */}
      <form onSubmit={submitWithoutReset(action)} key={`${agent.tools.join()}|${agent.temperature}|${agent.maxSteps}`}>
        <input type="hidden" name="id" value={agent.id} />
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id={`${agent.id}-config`} className="text-sm font-medium">
            Configure {agent.name}
          </h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="text-zinc-500 hover:text-zinc-100">
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <fieldset>
            <legend className="mb-2 text-xs text-zinc-400">Assigned tools</legend>
            <div className="space-y-1.5">
              {ALL_TOOLS.map((t) => (
                <label key={t} className="flex items-start gap-2.5 rounded-md border border-zinc-800 px-3 py-2 text-sm has-checked:border-zinc-600 has-checked:bg-zinc-900">
                  <input type="checkbox" name="tools" value={t} defaultChecked={agent.tools.includes(t)} className="mt-0.5 accent-emerald-500" />
                  <span>
                    <span className="block font-mono text-xs text-zinc-100">{t}</span>
                    <span className="block text-xs text-zinc-500">{TOOL_META[t].summary}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Temperature</span>
              <input
                name="temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                placeholder="default"
                defaultValue={agent.temperature ?? ""}
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Max steps</span>
              <input name="maxSteps" type="number" min={1} max={10} step={1} required defaultValue={agent.maxSteps} className={field} />
            </label>
          </div>
          {agent.id === "workspace-agent" && (
            <p className="text-xs text-zinc-500">Applies to the next message sent in Chat. Blank temperature uses the model default.</p>
          )}
          {state.status === "error" && (
            <p role="alert" className="text-xs text-red-400">
              {state.message}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button type="button" onClick={() => ref.current?.close()} className="h-8 rounded-md px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-60"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Save
          </button>
        </footer>
      </form>
    </dialog>
  );
}
