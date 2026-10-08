import Link from "next/link";
import { Check, Globe, Hash, MessageCircle, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TaskChannel } from "@/types/channels";
import type { AgentTaskEvent, TaskStatus } from "@/types/telemetry";

export const CHANNEL: Record<TaskChannel, { label: string; icon: LucideIcon; dot: string }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, dot: "bg-[#25a35a]" },
  slack: { label: "Slack", icon: Hash, dot: "bg-[#6b2a6e]" },
  web: { label: "Web", icon: Globe, dot: "bg-fg-faint" },
};

/** Uniform channel tile: same size and frame for every row; the corner dot is a quick visual key. */
export function ChannelTile({ channel, className }: { channel: TaskChannel; className?: string }) {
  const { label, icon: Icon, dot } = CHANNEL[channel];
  return (
    <span className={cn("border-line bg-canvas relative grid size-9 shrink-0 place-items-center rounded-[10px] border", className)} title={label}>
      <Icon className="text-fg-muted size-4" strokeWidth={1.75} aria-hidden />
      <span className={cn("ring-surface absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2", dot)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

const STATUS: Record<TaskStatus, { label: string; className: string; glyph: React.ReactNode }> = {
  running: { label: "running", className: "pill-copper", glyph: <span className="live-dot" /> },
  succeeded: { label: "done", className: "text-sage", glyph: <Check className="size-3" strokeWidth={2.5} /> },
  failed: { label: "failed", className: "border-rose/25 bg-rose/[0.06] text-rose", glyph: <X className="size-3" strokeWidth={2.5} /> },
  queued: { label: "queued", className: "", glyph: <span className="border-fg-faint size-1.5 rounded-full border border-dashed" /> },
};

/** Status as a small pill: glyph + word, never colour alone. */
export function StatusPill({ status }: { status: TaskStatus }) {
  const { label, className, glyph } = STATUS[status];
  return (
    <span className={cn("pill shrink-0", className)}>
      <span aria-hidden className="grid place-items-center">
        {glyph}
      </span>
      {label}
    </span>
  );
}

// Server-rendered, so a fixed zone keeps output stable; IST matches the business.
const CLOCK = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatAgo(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function ActivityFeed({ events, now, emptyChannel }: { events: AgentTaskEvent[]; now: Date; emptyChannel?: TaskChannel }) {
  if (events.length === 0) {
    return (
      <div className="panel px-6 py-16 text-center">
        {emptyChannel && <ChannelTile channel={emptyChannel} className="mx-auto" />}
        <p className="text-fg mt-4 text-[13.5px] font-medium">No {emptyChannel ? CHANNEL[emptyChannel].label : ""} activity yet</p>
        <p className="text-fg-subtle mt-1 text-[12.5px]">
          {emptyChannel && emptyChannel !== "web" ? (
            <>
              Messages appear here once the channel is connected.{" "}
              <Link href="/settings" className="text-copper-ink underline-offset-2 hover:underline">
                Set it up in Settings
              </Link>
            </>
          ) : (
            "Agent runs appear here as they happen."
          )}
        </p>
      </div>
    );
  }

  return (
    <ol className="panel overflow-hidden" aria-label="Agent activity">
      {events.map((e) => (
        <li key={`${e.channel}-${e.id}`} className="border-line hover:bg-surface-hover flex gap-4 border-b px-5 py-4 transition-colors last:border-b-0">
          <ChannelTile channel={e.channel} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <p className="text-fg min-w-0 flex-1 truncate text-[13.5px] font-medium">{e.task}</p>
              <StatusPill status={e.status} />
            </div>
            <p className={cn("mt-1 truncate text-[12.5px]", e.status === "failed" ? "text-rose" : "text-fg-subtle")}>{e.log}</p>
            <p className="text-fg-subtle mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] tabular-nums">
              <span className="text-fg-muted">{e.agent}</span>
              <span className="sm:hidden">{CLOCK.format(new Date(e.startedAt))}</span>
              <span>
                step {e.step}/{e.totalSteps}
              </span>
              <span>{formatDuration(e.durationMs)}</span>
              <span>{e.tokens.toLocaleString("en-US")} tok</span>
            </p>
          </div>

          <time dateTime={e.startedAt} className="hidden w-[5.5rem] shrink-0 text-right font-mono tabular-nums sm:block">
            <span className="text-fg-muted block text-[12px]">{CLOCK.format(new Date(e.startedAt))}</span>
            <span className="text-fg-faint mt-1 block text-[11px]">{formatAgo(e.startedAt, now)}</span>
          </time>
        </li>
      ))}
    </ol>
  );
}
