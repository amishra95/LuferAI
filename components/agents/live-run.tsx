"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";

import { formatTokens, formatUsd } from "@/lib/agents/spend";
import { parseSseFrames, type RunEvent } from "@/lib/agents/run-events";
import { cn } from "@/lib/utils";

const STEP_LABEL: Record<RunEvent["type"], string> = {
  system_prompt: "System prompt",
  thought: "Thought",
  tool_call: "Tool call",
  tool_response: "Tool response",
  final_output: "Final output",
  usage: "Usage",
  error: "Error",
  done: "Done",
};

type Status = "idle" | "running" | "done" | "failed";

/**
 * Runs one agent turn through GET /api/agents/stream and shows each step as it
 * arrives. Uses the agent's saved settings. Read with fetch rather than
 * EventSource: a dropped connection mustn't silently start a second run.
 */
export function LiveRun({ agentId, disabled }: { agentId: string; disabled?: string }) {
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    const text = prompt.trim();
    if (!text) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setEvents([]);
    setError(null);
    setStatus("running");
    try {
      const res = await fetch(`/api/agents/stream?${new URLSearchParams({ agent: agentId, prompt: text })}`, { signal: controller.signal });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The run couldn't start (HTTP ${res.status}).`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let failed = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const parsed = parseSseFrames(buffer + value);
        buffer = parsed.rest;
        if (parsed.events.length) {
          failed ||= parsed.events.some((e) => e.type === "error");
          setEvents((current) => [...current, ...parsed.events]);
        }
      }
      setStatus(failed ? "failed" : "done");
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus("idle");
        return;
      }
      setError(err instanceof Error ? err.message : "The run failed.");
      setStatus("failed");
    }
  }

  const running = status === "running";
  return (
    <section aria-labelledby={`${agentId}-live-run`} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${agentId}-live-run`} className="label-mono">
          Live run
        </h3>
        <span className="text-fg-subtle text-[11.5px]">Uses the saved settings</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex gap-2"
      >
        <label htmlFor={`${agentId}-run-prompt`} className="sr-only">
          Prompt
        </label>
        <input
          id={`${agentId}-run-prompt`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          disabled={Boolean(disabled)}
          placeholder={disabled ?? "e.g. Venues for 40 in Indiranagar under ₹2,500 a head"}
          className="field min-w-0 flex-1 text-[12.5px]"
        />
        {running ? (
          <button type="button" onClick={() => abort.current?.abort()} className="btn h-9 px-3 text-[12px]">
            <Square className="size-3" aria-hidden /> Stop
          </button>
        ) : (
          <button type="submit" disabled={Boolean(disabled) || !prompt.trim()} className="btn h-9 px-3 text-[12px]">
            <Play className="size-3" aria-hidden /> Run
          </button>
        )}
      </form>

      {(events.length > 0 || running || error) && (
        <ol aria-live="polite" aria-busy={running} className="border-line max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3">
          {events.map((e, i) => (
            <RunStep key={i} event={e} />
          ))}
          {running && (
            <li className="text-fg-subtle flex items-center gap-2 font-mono text-[11.5px]">
              <Loader2 className="size-3 animate-spin" aria-hidden /> running…
            </li>
          )}
          {error && (
            <li role="alert" className="text-rose text-[12.5px]">
              {error}
            </li>
          )}
        </ol>
      )}
    </section>
  );
}

function RunStep({ event: e }: { event: RunEvent }) {
  const tone = e.type === "error" || (e.type === "tool_response" && !e.ok) ? "text-rose" : e.type === "final_output" ? "text-fg" : "text-fg-muted";
  const step = "step" in e ? ` · step ${e.step}` : "";
  return (
    <li className="grid gap-1">
      <span className="label-mono">
        {STEP_LABEL[e.type]}
        <span className="text-fg-faint normal-case">
          {step}
          {e.type === "tool_call" || e.type === "tool_response" ? ` · ${e.toolName}` : ""}
          {e.type === "system_prompt" ? ` · ${e.model}` : ""}
        </span>
      </span>
      <Body event={e} className={tone} />
    </li>
  );
}

function Body({ event: e, className }: { event: RunEvent; className: string }) {
  const pre = (value: unknown) => (
    <pre className={cn("bg-surface max-h-40 overflow-auto rounded-md px-2.5 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap", className)}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
  switch (e.type) {
    case "system_prompt":
      return (
        <details>
          <summary className="text-fg-subtle cursor-pointer text-[12px]">{e.text.length} characters</summary>
          {pre(e.text)}
        </details>
      );
    case "thought":
    case "final_output":
      return <p className={cn("text-[12.5px] leading-5 whitespace-pre-wrap", className)}>{e.text}</p>;
    case "tool_call":
      return pre(e.input);
    case "tool_response":
      return pre(e.output);
    case "usage":
      return (
        <p className="text-fg-muted font-mono text-[11.5px] tabular-nums">
          {formatTokens(e.promptTokens)} in · {formatTokens(e.completionTokens)} out · {e.cost === null ? "unpriced" : formatUsd(e.cost)}
        </p>
      );
    case "error":
      return <p className={cn("text-[12.5px]", className)}>{e.message}</p>;
    case "done":
      return (
        <p className="text-fg-subtle font-mono text-[11.5px] tabular-nums">
          {e.steps} step{e.steps === 1 ? "" : "s"} · {(e.durationMs / 1000).toFixed(1)} s
        </p>
      );
  }
}
