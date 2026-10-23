"use client";

import { BarChart3, Cog, CreditCard, Hand, PenLine, PieChart, Search, ShieldCheck, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";

import type { ActivityKind, AgentActivity } from "@/lib/agents/tool-progress";
import { cn } from "@/lib/utils";

export const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  search: Search,
  policy: ShieldCheck,
  card: CreditCard,
  metrics: BarChart3,
  spend: PieChart,
  forecast: TrendingUp,
  tool: Cog,
  thinking: Sparkles,
  writing: PenLine,
  approval: Hand,
};

/**
 * What the agent is doing right now, shown while a turn is submitted or
 * streaming. A graphite-light pill with a pulsing dot; its row has a fixed height
 * and the label truncates, so streaming updates never shift the layout.
 */
export function AgentProgressIndicator({
  status,
  activity,
  className,
}: {
  status: "submitted" | "streaming" | "ready" | "error";
  activity: AgentActivity;
  className?: string;
}) {
  if (status !== "submitted" && status !== "streaming") return null;
  const Icon = ACTIVITY_ICON[activity.kind];
  return (
    <div role="status" aria-live="polite" className={cn("flex h-7 min-w-0 items-center", className)}>
      <span className="on-graphite bg-graphite-light rounded-badge inline-flex h-7 max-w-full min-w-0 items-center gap-2 px-2.5 text-caption font-medium leading-none">
        <span aria-hidden className="status-dot bg-gold animate-pulse motion-reduce:animate-none" />
        <Icon aria-hidden className="text-fg-subtle size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="text-fg-subtle truncate">{activity.label}…</span>
        {activity.step ? <span className="text-fg-subtle shrink-0 tabular-nums">· step {activity.step}</span> : null}
      </span>
    </div>
  );
}
