import { Check, Globe, Hash, MessageCircle, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TaskChannel } from "@/types/channels";
import type { AgentTaskEvent, TaskStatus } from "@/types/telemetry";

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  queued: "Queued",
};

/** One glyph per state, distinguishable by shape as well as colour. */
export function StatusGlyph({ status }: { status: TaskStatus }) {
  const base = "grid size-[18px] shrink-0 place-items-center rounded-full";
  switch (status) {
    case "running":
      return (
        <span className={cn(base, "bg-copper/10")} title="Running">
          <span className="live-dot" />
        </span>
      );
    case "succeeded":
      return (
        <span className={cn(base, "bg-sage/10 text-sage")} title="Succeeded">
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "bg-rose/10 text-rose")} title="Failed">
          <X className="size-2.5" strokeWidth={3} />
        </span>
      );
    case "queued":
      return (
        <span className={base} title="Queued">
          <span className="border-fg-faint size-2 rounded-full border border-dashed" />
        </span>
      );
  }
}

const CHANNEL: Record<TaskChannel, { label: string; icon: LucideIcon; dot: string }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, dot: "bg-[#25a35a]" },
  slack: { label: "Slack", icon: Hash, dot: "bg-[#6b2a6e]" },
  web: { label: "Web", icon: Globe, dot: "bg-fg-faint" },
};

/** Where a task came from. Icon + label carry the meaning; the dot is a quick visual key. */
export function ChannelBadge({ channel }: { channel: TaskChannel }) {
  const { label, icon: Icon, dot } = CHANNEL[channel];
  return (
    <span className="border-line bg-surface text-fg-muted inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border px-1.5 font-mono text-[10.5px]">
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      <Icon className="size-3" strokeWidth={2} aria-hidden />
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
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function ActivityFeed({ events, now, liveCount }: { events: AgentTaskEvent[]; now: Date; liveCount: number }) {
  const running = events.filter((e) => e.status === "running").length;

  return (
    <section className="panel" aria-labelledby="activity-heading">
      <header className="border-line flex items-center justify-between border-b px-5 py-3.5">
        <h2 id="activity-heading" className="text-fg text-[13.5px] font-medium">
          Activity
        </h2>
        <span className="text-fg-subtle flex items-center gap-2 font-mono text-[11px]">
          {running > 0 && <span className="live-dot" aria-hidden />}
          {running} running · {liveCount} live · {events.length - liveCount} sample
        </span>
      </header>

      <ol>
        {events.map((e) => (
          <li
            key={e.id}
            className="border-line hover:bg-surface-hover flex gap-3.5 border-b px-5 py-3.5 transition-colors last:border-b-0"
          >
            <div className="pt-px">
              <StatusGlyph status={e.status} />
              <span className="sr-only">{STATUS_LABEL[e.status]}</span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <ChannelBadge channel={e.channel} />
                <p className="text-fg min-w-0 flex-1 truncate text-[13.5px]">{e.task}</p>
                <time
                  dateTime={e.startedAt}
                  title={`${formatAgo(e.startedAt, now)} ago`}
                  className="text-fg-subtle shrink-0 font-mono text-[11px] tabular-nums"
                >
                  {CLOCK.format(new Date(e.startedAt))}
                  <span className="text-fg-faint hidden sm:inline"> · {formatAgo(e.startedAt, now)}</span>
                </time>
              </div>
              <p className={cn("mt-1 truncate text-[12.5px]", e.status === "failed" ? "text-rose/90" : "text-fg-subtle")}>{e.log}</p>
              <p className="text-fg-subtle mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
                <span className="text-fg-muted">{e.agent}</span>
                <span>
                  step {e.step}/{e.totalSteps}
                </span>
                <span>{formatDuration(e.durationMs)}</span>
                <span>{e.tokens.toLocaleString("en-US")} tok</span>
                <span className="hidden sm:inline">{e.id}</span>
                {e.sample && <span className="text-fg-faint">sample</span>}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
