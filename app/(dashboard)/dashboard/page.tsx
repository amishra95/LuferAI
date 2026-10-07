import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { TelemetryCard } from "@/components/dashboard/telemetry-card";
import { getActivity } from "@/lib/telemetry/activity";
import { getTelemetryMetrics, TELEMETRY_SOURCE } from "@/lib/telemetry/sample-data";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  const metrics = getTelemetryMetrics();
  const { now, events, liveCount } = getActivity();

  return (
    <Page>
      <PageHeader
        title="Overview"
        description="Agent fleet health over the last two hours."
        badge={TELEMETRY_SOURCE === "sample" && <NoticePill>sample data</NoticePill>}
        actions={
          <Link href="/chat" className="btn">
            Open workspace
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <TelemetryCard key={m.id} metric={m} />
        ))}
      </div>

      <div className="mt-3">
        <ActivityFeed events={events} now={now} liveCount={liveCount} />
      </div>
    </Page>
  );
}
