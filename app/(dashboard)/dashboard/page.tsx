import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { ChannelFilter, type ChannelFilterValue } from "@/components/dashboard/channel-filter";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { AgentsWidget, ChannelsWidget, type ChannelSummary } from "@/components/dashboard/overview-widgets";
import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { agentSnapshot } from "@/lib/agents/store";
import { isChannelConfigured } from "@/lib/channels/config";
import { channelStore } from "@/lib/channels/store";
import { isRedisConfigured } from "@/lib/data/local-store";
import { getActivity } from "@/lib/telemetry/activity";
import { computeTelemetryMetrics } from "@/lib/telemetry/runs";
import type { TaskChannel } from "@/types/channels";

export const metadata: Metadata = { title: "Overview" };

const FILTERS: ChannelFilterValue[] = ["all", "whatsapp", "slack", "web"];

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { channel } = await searchParams;
  const filter: ChannelFilterValue = FILTERS.includes(channel as ChannelFilterValue) ? (channel as ChannelFilterValue) : "all";

  const [{ now, events, runs, channelEvents: allChannelEvents, liveError }, snapshot] = await Promise.all([getActivity(), agentSnapshot()]);
  const enabledAgents = snapshot.agents.filter(({ agent }) => agent.enabled).length;
  const metrics = computeTelemetryMetrics(runs, now.getTime(), enabledAgents);
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, f === "all" ? events.length : events.filter((e) => e.channel === f).length])
  ) as Record<ChannelFilterValue, number>;
  const visible = filter === "all" ? events : events.filter((e) => e.channel === filter);

  const channelEvents = allChannelEvents.filter((e) => !e.test);
  const enabled = await Promise.all(
    (["whatsapp", "slack"] as const).map((id) =>
      channelStore()
        .isEnabled(id)
        .catch(() => true)
    )
  );
  const channels: ChannelSummary[] = (["whatsapp", "slack"] as const).map((id, i) => ({
    id,
    label: id === "whatsapp" ? "WhatsApp" : "Slack",
    state: !isChannelConfigured(id) ? "setup" : enabled[i] ? "live" : "paused",
    messages: channelEvents.filter((e) => e.channel === id).length,
    bookings: channelEvents.filter((e) => e.channel === id && e.status === "booked").length,
  }));
  const agents = snapshot.agents.map(({ agent, status }) => ({ id: agent.id, name: agent.name, status, runs: agent.runCount }));

  return (
    <Page>
      <PageHeader
        title="Overview"
        description="Agent fleet health and booking traffic over the last two hours."
        badge={!isRedisConfigured() && <NoticePill>this instance only</NoticePill>}
        actions={
          <Link href="/chat" className="btn">
            Open workspace
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />

      <MetricStrip metrics={metrics} />

      <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-6">
        <section aria-labelledby="activity-heading" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="activity-heading" className="text-fg text-[15px] font-semibold tracking-[-0.01em]">
                Activity
              </h2>
              <p className="text-fg-subtle mt-0.5 font-mono text-[11px] tabular-nums">
                {events.length} recent · times in IST
              </p>
            </div>
            <ChannelFilter value={filter} counts={counts} />
          </div>
          {liveError && (
            <p role="status" className="border-rose/20 bg-rose/[0.04] text-rose mb-3 rounded-xl border px-4 py-2.5 text-[12.5px]">
              Some activity couldn&apos;t be loaded right now ({liveError}).
            </p>
          )}
          <ActivityFeed events={visible} now={now} emptyChannel={filter === "all" ? undefined : (filter as TaskChannel)} />
        </section>

        <aside className="space-y-4 xl:pt-[3.25rem]" aria-label="Status">
          <ChannelsWidget channels={channels} />
          <AgentsWidget agents={agents} />
        </aside>
      </div>
    </Page>
  );
}
