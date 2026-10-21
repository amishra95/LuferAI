"use client";

import { useState } from "react";

import { LiveRun } from "@/components/agents/live-run";
import { TOOL_META } from "@/components/chat/tool-meta";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { agentPatchFromForm, isPromptable, MAX_INSTRUCTIONS, MODEL_BACKEND_LABEL, takesTemperature, type AgentPatch, type ModelBackend } from "@/lib/agents/config";
import { cn } from "@/lib/utils";
import type { AgentRecord } from "@/types/agents";
import type { ChatToolName } from "@/types/chat";

const ALL_TOOLS = Object.keys(TOOL_META) as ChatToolName[];

/** A model backend and whether this environment has its API key. */
export interface BackendOption {
  id: ModelBackend;
  configured: boolean;
}

/**
 * The agent's settings in a slide-over: model backend, temperature, system
 * prompt (operator instructions), tools and max steps, saved to Supabase via
 * updateAgentConfig; plus a live run against the saved settings. Validated here
 * with the server's rules, so a save closes the drawer and shows at once; a
 * server failure rolls back with a toast.
 */
export function AgentSettingsSheet({
  agent,
  backends,
  open,
  onOpenChange,
  onSave,
}: {
  agent: AgentRecord;
  backends: BackendOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: AgentPatch) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="bg-elevated text-fg border-line w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-line border-b px-6 pt-5 pb-4">
          <SheetTitle className="text-body font-semibold tracking-[-0.01em]">{agent.name}</SheetTitle>
          <SheetDescription className="text-fg-subtle font-mono text-caption">{agent.id}</SheetDescription>
        </SheetHeader>
        {/* key resets the form to the saved values whenever they change. */}
        <SettingsForm
          key={`${agent.model}|${agent.temperature}|${agent.tools.join()}|${agent.maxSteps}|${agent.instructions}`}
          agent={agent}
          backends={backends}
          onSave={(patch) => {
            onOpenChange(false);
            onSave(patch);
          }}
          onCancel={() => onOpenChange(false)}
        />
        <div className="border-line border-t px-6 py-5">
          <LiveRun agentId={agent.id} disabled={!agent.enabled ? "Enable the agent to run it" : !backends.find((b) => b.id === agent.model)?.configured ? "Its model backend isn't configured" : undefined} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SettingsForm({ agent, backends, onSave, onCancel }: { agent: AgentRecord; backends: BackendOption[]; onSave: (patch: AgentPatch) => void; onCancel: () => void }) {
  const [model, setModel] = useState<ModelBackend>(agent.model);
  const [useDefault, setUseDefault] = useState(agent.temperature === null);
  const [temperature, setTemperature] = useState(agent.temperature ?? 0.7);
  const [error, setError] = useState<string | null>(null);
  const promptable = isPromptable(agent.id);
  const tunable = takesTemperature(model);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = agentPatchFromForm(agent.id, {
      tools: form.getAll("tools").map(String),
      // Claude runs at its default; keep the saved value for when it's switched back.
      temperature: !tunable ? (agent.temperature === null ? "" : String(agent.temperature)) : useDefault ? "" : String(temperature),
      maxSteps: String(form.get("maxSteps") ?? ""),
      model,
      ...(promptable && { instructions: String(form.get("instructions") ?? "") }),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onSave(result.patch);
  }

  return (
    <form onSubmit={submit}>
      <div className="space-y-7 px-6 py-5">
        <fieldset>
          <legend className="label-mono mb-2.5">Model backend</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {backends.map((b) => (
              <label
                key={b.id}
                className="border-line hover:border-line-strong has-checked:border-fg/40 has-checked:bg-fg/[0.06] flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3.5 py-3 transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <input type="radio" name="model" value={b.id} checked={model === b.id} onChange={() => setModel(b.id)} className="accent-fg size-3.5" />
                  <span className="text-fg text-meta font-medium">{MODEL_BACKEND_LABEL[b.id]}</span>
                </span>
                <span className="text-fg-subtle pl-6 font-mono text-caption">{b.id}</span>
                {!b.configured && <span className="text-warn pl-6 text-caption">API key not set here</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={!tunable}>
          <legend className="label-mono mb-2.5 flex w-full items-baseline justify-between">
            <span>Temperature</span>
            <output htmlFor={`${agent.id}-temperature`} className="text-fg font-mono text-caption normal-case tabular-nums">
              {!tunable || useDefault ? "model default" : temperature.toFixed(2)}
            </output>
          </legend>
          <input
            id={`${agent.id}-temperature`}
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            disabled={!tunable || useDefault}
            onChange={(e) => setTemperature(Number(e.target.value))}
            aria-label="Temperature"
            className="accent-fg w-full disabled:opacity-40"
          />
          <div className="text-fg-faint mt-1 flex justify-between font-mono text-caption" aria-hidden>
            <span>0 · precise</span>
            <span>2 · varied</span>
          </div>
          {tunable ? (
            <label className="text-fg-muted mt-2 flex items-center gap-2 text-meta">
              <input type="checkbox" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} className="accent-fg size-3.5" />
              Use the model&apos;s default
            </label>
          ) : (
            <p className="text-fg-subtle mt-2 text-meta">Claude Sonnet 5.5 runs at its default temperature; the API doesn&apos;t accept other values.</p>
          )}
        </fieldset>

        {promptable ? (
          <label className="block">
            <span className="label-mono mb-2 block">System prompt</span>
            <textarea
              name="instructions"
              rows={6}
              maxLength={MAX_INSTRUCTIONS}
              defaultValue={agent.instructions}
              placeholder="Optional. Added after the built-in prompt, e.g. “Prefer venues in Indiranagar.”"
              className="field h-auto resize-y py-2 text-meta leading-5"
            />
            <span className="text-fg-subtle mt-1.5 block text-caption">
              Appended to the agent&apos;s built-in prompt, which keeps its guardrails (no invented figures, data scope). Up to {MAX_INSTRUCTIONS} characters.
            </span>
          </label>
        ) : (
          <div>
            <span className="label-mono mb-2 block">System prompt</span>
            <p className="text-fg-subtle text-meta">This agent&apos;s prompt is built for each request, so it doesn&apos;t take custom instructions.</p>
          </div>
        )}

        <fieldset>
          <legend className="label-mono mb-2.5">Tools</legend>
          <div className="space-y-2">
            {ALL_TOOLS.map((t) => (
              <label
                key={t}
                className="border-line hover:border-line-strong has-checked:border-fg/40 has-checked:bg-fg/[0.06] flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors"
              >
                <input type="checkbox" name="tools" value={t} defaultChecked={agent.tools.includes(t)} className="accent-fg mt-0.5 size-3.5" />
                <span>
                  <span className="text-fg block font-mono text-caption">{t}</span>
                  <span className="text-fg-subtle mt-0.5 block text-meta">{TOOL_META[t].summary}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block max-w-40">
          <span className="label-mono mb-2 block">Max steps</span>
          <input name="maxSteps" type="number" min={1} max={10} step={1} required defaultValue={agent.maxSteps} className="field font-mono" />
        </label>

        {agent.id === "workspace-agent" && <p className="text-fg-subtle text-meta">Applies to the next message sent in Chat and the concierge on /client.</p>}
        {error && (
          <p role="alert" className="text-rose text-meta">
            {error}
          </p>
        )}
      </div>

      <footer className={cn("border-line bg-elevated sticky bottom-0 flex justify-end gap-2 border-t px-6 py-4")}>
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          Save changes
        </button>
      </footer>
    </form>
  );
}
