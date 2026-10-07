import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { ChannelTile } from "@/components/dashboard/activity-feed";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/types/agents";
import type { ChannelId } from "@/types/channels";

function Widget({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="panel" aria-label={title}>
      <header className="border-line flex items-center justify-between border-b px-5 py-3.5">
        <h2 className="label-mono">{title}</h2>
        <Link href={href} className="text-fg-subtle hover:text-fg inline-flex items-center gap-0.5 text-[12px] transition-colors">
          Manage <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </header>
      {children}
    </section>
  );
}

export type ChannelSummary = { id: ChannelId; label: string; state: "live" | "paused" | "setup"; messages: number; bookings: number };

const STATE_PILL = {
  live: (
    <span className="pill pill-copper">
      <span className="live-dot" aria-hidden /> live
    </span>
  ),
  paused: (
    <span className="pill">
      <span className="bg-fg-subtle size-1.5 rounded-full" aria-hidden /> paused
    </span>
  ),
  setup: (
    <span className="pill">
      <span className="border-fg-faint size-1.5 rounded-full border" aria-hidden /> setup
    </span>
  ),
};

export function ChannelsWidget({ channels }: { channels: ChannelSummary[] }) {
  return (
    <Widget title="Channels" href="/settings">
      <ul>
        {channels.map((c) => (
          <li key={c.id} className="border-line flex items-center gap-3 border-b px-5 py-3.5 last:border-b-0">
            <ChannelTile channel={c.id} />
            <div className="min-w-0 flex-1">
              <p className="text-fg text-[13px] font-medium">{c.label}</p>
              <p className="text-fg-subtle mt-0.5 font-mono text-[11px] tabular-nums">
                {c.messages} msg · {c.bookings} booked
              </p>
            </div>
            {STATE_PILL[c.state]}
          </li>
        ))}
      </ul>
    </Widget>
  );
}

const AGENT_DOT: Record<AgentStatus, string> = {
  active: "live-dot",
  idle: "size-1.5 rounded-full bg-fg-subtle",
  error: "size-1.5 rounded-full bg-rose",
  disabled: "size-1.5 rounded-full border border-fg-faint",
};

export function AgentsWidget({ agents }: { agents: { id: string; name: string; status: AgentStatus; runs: number }[] }) {
  return (
    <Widget title="Agents" href="/agents">
      <ul className="py-1.5">
        {agents.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-5 py-2">
            <span className={cn("shrink-0", AGENT_DOT[a.status])} aria-hidden />
            <span className="text-fg-muted min-w-0 flex-1 truncate text-[13px]">{a.name}</span>
            <span className="text-fg-subtle font-mono text-[11px] tabular-nums">
              {a.status === "disabled" ? "off" : a.status} · {a.runs}
            </span>
          </li>
        ))}
      </ul>
    </Widget>
  );
}
