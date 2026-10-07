import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { NoticePill, PageHeader } from "@/components/dashboard/page-header";
import { TelemetryCard } from "@/components/dashboard/telemetry-card";
import { getRecentAgentTasks, getTelemetryMetrics, TELEMETRY_SOURCE } from "@/lib/telemetry/sample-data";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  const now = new Date("2026-10-07T12:00:00Z");
  const metrics = getTelemetryMetrics();
  const events = getRecentAgentTasks(now);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Overview"
        description="Agent fleet health over the last 2 hours."
        badge={TELEMETRY_SOURCE === "sample" && <NoticePill>Sample data</NoticePill>}
        actions={
          <Link
            href="/chat"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
          >
            <MessageSquare className="size-4" aria-hidden />
            Open workspace
          </Link>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <TelemetryCard key={m.id} metric={m} />
        ))}
      </div>

      <div className="mt-3">
        <ActivityFeed events={events} now={now} />
      </div>
    </div>
  );
}
