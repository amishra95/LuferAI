"use client";

import { X } from "lucide-react";

import { TOOL_META, toolName, toolPhase, type LuferToolPart } from "@/components/chat/tool-meta";
import { InspectButton } from "@/components/workspace/inspect";
import { cn } from "@/lib/utils";
import type { ChatToolName } from "@/types/chat";

export type SessionInfo = {
  model: string;
  /** No model configured. */
  offline: boolean;
  status: string;
  messageCount: number;
  totalTokens: number;
  /** The latest reply's trace, when the server shared it (admins). */
  traceId: string | null;
};

const PHASE_DOT = {
  running: "status-dot bg-sage",
  done: "size-1.5 rounded-full bg-sage",
  error: "size-1.5 rounded-full bg-rose",
  denied: "size-1.5 rounded-full border border-fg-faint",
} as const;

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-line border-b px-5 py-5 last:border-b-0">
      <h3 className="label-mono mb-3 flex items-center justify-between">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="border-line text-fg-muted max-h-72 overflow-auto rounded-lg border bg-surface-hover p-3 font-mono text-[11px] leading-5">
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
  const rows: [string, React.ReactNode][] = [
    ["model", session.model],
    [
      "mode",
      <span key="m" className={session.offline ? "text-fg-muted" : "text-fg"}>
        {session.offline ? "offline" : "live"}
      </span>,
    ],
    ["status", session.status],
    ["messages", session.messageCount],
    ["tokens", session.totalTokens ? session.totalTokens.toLocaleString("en-US") : "—"],
    ...(session.traceId
      ? ([
          [
            "trace",
            <InspectButton key="t" kind="trace" id={session.traceId}>
              {session.traceId.slice(0, 12)}
            </InspectButton>,
          ],
        ] as [string, React.ReactNode][])
      : []),
  ];

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden" aria-label="Context and tool inspector">
      <header className="border-line flex h-12 shrink-0 items-center justify-between border-b pr-2.5 pl-5">
        <h2 className="text-fg text-[13px] font-medium">Inspector</h2>
        <button type="button" onClick={onClose} aria-label="Close inspector" className="btn btn-ghost btn-icon size-8">
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <Section title="Session">
          <dl className="space-y-2 font-mono text-[12px]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3">
                <dt className="text-fg-subtle">{k}</dt>
                <span aria-hidden className="border-line mb-1 flex-1 border-b border-dotted" />
                <dd className="text-fg max-w-[60%] truncate tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Tools">
          <ul className="space-y-3">
            {(Object.keys(TOOL_META) as ChatToolName[]).map((name) => {
              const { icon: Icon, summary } = TOOL_META[name];
              return (
                <li key={name} className="flex gap-2.5">
                  <Icon className="text-fg-faint mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-fg font-mono text-[12px]">{name}</p>
                    <p className="text-fg-subtle mt-0.5 text-[12px] leading-5">{summary}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Calls" aside={<span className="text-fg-muted tabular-nums">{toolCalls.length}</span>}>
          {toolCalls.length === 0 ? (
            <p className="text-fg-subtle text-[12.5px]">Tool calls appear here as the agent makes them.</p>
          ) : (
            <ol className="-mx-2 space-y-px">
              {toolCalls.map((t, i) => {
                const phase = toolPhase(t);
                const active = t.toolCallId === selected?.toolCallId;
                return (
                  <li key={t.toolCallId}>
                    <button
                      type="button"
                      onClick={() => onSelectTool(t.toolCallId)}
                      aria-pressed={active}
                      className={cn(
                        "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left font-mono text-[12px] transition-colors",
                        active ? "bg-surface-raised text-fg" : "text-fg-muted hover:bg-surface-hover"
                      )}
                    >
                      <span className="text-fg-subtle w-4 text-[10.5px] tabular-nums">{i + 1}</span>
                      <span className={cn("shrink-0", PHASE_DOT[phase])} aria-hidden />
                      <span className="truncate">{toolName(t)}</span>
                      <span className="text-fg-subtle ml-auto text-[10.5px]">{phase}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        {selected && (
          <Section title={`Call · ${toolName(selected)}`}>
            <p className="text-fg-subtle mb-1.5 font-mono text-[11px]">input</p>
            <Json value={selected.input} />
            <p className="text-fg-subtle mt-4 mb-1.5 font-mono text-[11px]">output</p>
            {selected.state === "output-error" ? (
              <p className="border-rose/25 bg-rose/[0.06] text-rose rounded-lg border p-3 font-mono text-[11px]">{selected.errorText}</p>
            ) : (
              <Json value={selected.state === "output-available" ? selected.output : undefined} />
            )}
            <p className="text-fg-subtle mt-3 truncate font-mono text-[10.5px]">{selected.toolCallId}</p>
          </Section>
        )}
      </div>
    </aside>
  );
}
