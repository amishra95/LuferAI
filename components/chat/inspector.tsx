"use client";

import { Wrench, X } from "lucide-react";

import { TOOL_META, toolName, toolPhase, type LuferToolPart } from "@/components/chat/tool-meta";
import { cn } from "@/lib/utils";
import type { ChatToolName } from "@/types/chat";

export type SessionInfo = {
  model: string;
  demo: boolean;
  status: string;
  messageCount: number;
  totalTokens: number;
};

const PHASE_DOT = {
  running: "bg-sky-400 animate-pulse",
  done: "bg-emerald-400",
  error: "bg-red-400",
  denied: "bg-amber-400",
} as const;

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-zinc-800 px-4 py-3">
      <h3 className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-wider text-zinc-500 uppercase">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">
      {value === undefined ? "—" : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Inspector({
  session,
  toolCalls,
  selectedToolCallId,
  onSelectTool,
  onClose,
}: {
  session: SessionInfo;
  toolCalls: LuferToolPart[];
  selectedToolCallId: string | null;
  onSelectTool: (toolCallId: string | null) => void;
  onClose: () => void;
}) {
  const selected = toolCalls.find((t) => t.toolCallId === selectedToolCallId) ?? toolCalls.at(-1);

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-zinc-950" aria-label="Context and tool inspector">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <h2 className="text-sm font-medium text-zinc-100">Inspector</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <Section title="Session">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-zinc-500">Model</dt>
            <dd className="truncate text-right font-mono text-zinc-200">{session.model}</dd>
            <dt className="text-zinc-500">Mode</dt>
            <dd className="text-right">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[11px]",
                  session.demo ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
                )}
              >
                {session.demo ? "demo" : "live"}
              </span>
            </dd>
            <dt className="text-zinc-500">Status</dt>
            <dd className="text-right font-mono text-zinc-200">{session.status}</dd>
            <dt className="text-zinc-500">Messages</dt>
            <dd className="text-right font-mono text-zinc-200 tabular-nums">{session.messageCount}</dd>
            <dt className="text-zinc-500">Tokens</dt>
            <dd className="text-right font-mono text-zinc-200 tabular-nums">
              {session.totalTokens ? session.totalTokens.toLocaleString("en-US") : "—"}
            </dd>
          </dl>
        </Section>

        <Section title="Available tools">
          <ul className="space-y-2">
            {(Object.keys(TOOL_META) as ChatToolName[]).map((name) => {
              const { icon: Icon, summary } = TOOL_META[name];
              return (
                <li key={name} className="flex gap-2 text-xs">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-zinc-500" aria-hidden />
                  <div>
                    <p className="font-mono text-zinc-200">{name}</p>
                    <p className="text-zinc-500">{summary}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Tool calls" aside={<span className="tabular-nums">{toolCalls.length}</span>}>
          {toolCalls.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <Wrench className="size-3.5" aria-hidden /> No tool calls yet.
            </p>
          ) : (
            <ol className="space-y-1">
              {toolCalls.map((t) => {
                const phase = toolPhase(t);
                const active = t.toolCallId === selected?.toolCallId;
                return (
                  <li key={t.toolCallId}>
                    <button
                      type="button"
                      onClick={() => onSelectTool(t.toolCallId)}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs text-zinc-400 hover:bg-zinc-900",
                        active && "bg-zinc-900 text-zinc-100"
                      )}
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", PHASE_DOT[phase])} aria-hidden />
                      <span className="truncate">{toolName(t)}</span>
                      <span className="ml-auto text-[10px] text-zinc-600">{phase}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        {selected && (
          <Section title={`Call · ${toolName(selected)}`}>
            <p className="mb-1 text-[11px] text-zinc-500">Input</p>
            <Json value={selected.input} />
            <p className="mt-3 mb-1 text-[11px] text-zinc-500">Output</p>
            {selected.state === "output-error" ? (
              <p className="rounded border border-red-500/25 bg-red-500/10 p-2 font-mono text-[11px] text-red-300">{selected.errorText}</p>
            ) : (
              <Json value={selected.state === "output-available" ? selected.output : undefined} />
            )}
            <p className="mt-2 truncate font-mono text-[10px] text-zinc-600">{selected.toolCallId}</p>
          </Section>
        )}
      </div>
    </aside>
  );
}
