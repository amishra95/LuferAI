import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, Coins, Timer } from "lucide-react";

import { LatencyChart, RunsChart } from "@/components/admin/run-charts";
import { TracePanels } from "@/components/admin/trace-panels";
import { EmptyState } from "@/components/portal/empty-state";
import { LiveBadge } from "@/components/portal/live-badge";
import { PortalShell } from "@/components/portal/portal-shell";
import { segmentClass } from "@/components/portal/segment";
import { StatCard } from "@/components/portal/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePortal } from "@/lib/auth/session";
import { isRedisConfigured } from "@/lib/data/local-store";
import { formatMs } from "@/lib/telemetry/format";
import { metricChange, RUN_RANGES, summarizeRuns, type RunRange } from "@/lib/telemetry/metrics";
import { listAgentRuns, RUN_LOG_LIMIT } from "@/lib/telemetry/runs";
import { summarizeTraces, TRACE_LIST_LIMIT, tracer } from "@/lib/tracer";

export const metadata: Metadata = { title: "Agent analytics" };

const RANGE_LABEL: Record<RunRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
const CHANNEL_LABEL: Record<string, string> = { web: "Web app", whatsapp: "WhatsApp", slack: "Slack" };

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const int = (n: number) => n.toLocaleString("en-IN");
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

async function loadSummary(range: RunRange) {
  const errors: string[] = [];
  const [runs, traces] = await Promise.all([
    listAgentRuns().catch((err) => {
      console.error("admin analytics: could not load agent runs", err);
      errors.push(err instanceof Error ? err.message : "Could not load agent runs");
      return [];
    }),
    tracer.listTraces({ limit: TRACE_LIST_LIMIT }).catch((err) => {
      console.error("admin analytics: could not load traces", err);
      errors.push(err instanceof Error ? err.message : "Could not load traces");
      return [];
    }),
  ]);
  const loadError = errors.length ? errors.join("; ") : null;
  const s = summarizeRuns(runs, Date.now(), range);
  const traceSummary = summarizeTraces(traces, Date.parse(s.from));
  // The log is capped; say so when the cap cuts into the selected period.
  const oldest = runs.at(-1)?.at;
  const truncated = runs.length >= RUN_LOG_LIMIT && oldest !== undefined && oldest > s.from;
  return { s, traceSummary, loadError, oldest, truncated };
}

/**
 * Agent analytics from the run log (lib/telemetry/runs.ts): every workspace
 * chat, WhatsApp/Slack reply, /api/ai/* call and agent test, in IST buckets.
 */
export default async function AgentAnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  // The admin layout already gates; this keeps the page safe if it's ever moved.
  await requirePortal("/admin");
  const { range: rangeParam } = await searchParams;
  const range: RunRange = RUN_RANGES.includes(rangeParam as RunRange) ? (rangeParam as RunRange) : "7d";

  const { s, traceSummary, loadError, oldest, truncated } = await loadSummary(range);
  const { totals: t, previous: p } = s;
  const asOf = new Date(s.to);
  const versus = `vs previous ${RANGE_LABEL[range]}`;
  const noComparison = "No runs in the previous period to compare";
  // Volume (runs, tokens) is neither good nor bad; reliability up and latency down are.
  const runsChange = metricChange(t.runs, p.runs, { unit: "%", better: "neither" });
  const successChange = metricChange(t.successRate, p.successRate, { unit: "pts", better: "up" });
  const latencyChange = metricChange(t.p50Ms, p.p50Ms, { unit: "%", better: "down" });
  const tokensChange = t.runs && p.runs ? metricChange(t.tokens, p.tokens, { unit: "%", better: "neither" }) : null;

  return (
    <PortalShell
      theme="concierge"
      portal="/admin"
      title="Agent analytics"
      subtitle="Runs, reliability, latency and token use across every agent and channel, plus request traces."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <LiveBadge asOf={asOf} partial={Boolean(loadError)} />
          <nav aria-label="Time range" className="flex gap-1.5">
            {RUN_RANGES.map((r) => (
              <Link key={r} href={`/admin/analytics?range=${r}`} scroll={false} aria-current={r === range ? "page" : undefined} className={segmentClass(r === range)}>
                {r}
              </Link>
            ))}
          </nav>
        </div>
      }
    >
      {loadError && (
        <p role="status" className="border-rose/20 bg-rose/[0.04] text-rose mb-6 rounded-xl border px-4 py-2.5 text-[12.5px]">
          Some analytics couldn&apos;t be loaded right now ({loadError}).
        </p>
      )}

      <section aria-label={`Summary, last ${RANGE_LABEL[range]}`} className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Runs" value={int(t.runs)} change={runsChange} hint={runsChange ? versus : noComparison} icon={Activity} />
        <StatCard
          label="Success rate"
          value={pct(t.successRate)}
          change={successChange}
          hint={t.runs ? `${int(t.failed)} failed${successChange ? ` · ${versus}` : ""}` : "No runs yet"}
          icon={CheckCircle2}
        />
        <StatCard
          label="Median latency"
          value={formatMs(t.p50Ms)}
          change={latencyChange}
          hint={t.runs ? `p95 ${formatMs(t.p95Ms)}${latencyChange ? ` · ${versus}` : ""}` : "No runs to measure"}
          icon={Timer}
        />
        <StatCard label="Tokens" value={int(t.tokens)} change={tokensChange} hint={tokensChange ? versus : noComparison} icon={Coins} />
      </section>

      {t.runs === 0 ? (
        <EmptyState
          className="mb-6"
          headingLevel={2}
          icon={Activity}
          title={`No agent runs in the last ${RANGE_LABEL[range]}`}
          description="Runs are recorded from workspace chat, WhatsApp and Slack replies, the AI tools in the portals and agent tests."
          action={
            <>
              <Link href="/agents" className="btn btn-primary">
                Run an agent test
              </Link>
              {range !== "30d" ? (
                <Link href="/admin/analytics?range=30d" scroll={false} className="btn">
                  View last 30 days
                </Link>
              ) : null}
            </>
          }
        />
      ) : (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Runs</CardTitle>
                <CardDescription>Per {s.bucketMs <= 3_600_000 ? "hour" : "day"}, IST</CardDescription>
              </CardHeader>
              <CardContent>
                <RunsChart buckets={s.buckets} bucketMs={s.bucketMs} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Median latency</CardTitle>
                <CardDescription>Time from request to finished run · gaps mean nothing ran</CardDescription>
              </CardHeader>
              <CardContent>
                <LatencyChart buckets={s.buckets} bucketMs={s.bucketMs} />
              </CardContent>
            </Card>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>By agent</CardTitle>
              <CardDescription>Busiest first</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Success</TableHead>
                    <TableHead className="text-right">p50</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">p95</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Tokens</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Last run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.agents.map((a) => (
                    <TableRow key={a.agent}>
                      <TableCell className="font-mono text-[12.5px]">{a.agent}</TableCell>
                      <TableCell className="text-right tabular-nums">{int(a.runs)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.failed > 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose" title={`${a.failed} failed`}>
                            <AlertTriangle className="size-3" aria-hidden />
                            {pct(a.successRate)}
                            <span className="sr-only">, {a.failed} failed</span>
                          </span>
                        ) : (
                          pct(a.successRate)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMs(a.p50Ms)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatMs(a.p95Ms)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{int(a.tokens)}</TableCell>
                      <TableCell className="text-fg-subtle hidden text-right tabular-nums lg:table-cell">{when.format(new Date(a.lastAt))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>By channel</CardTitle>
                <CardDescription>Where requests came from</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.channels.map((c) => (
                      <TableRow key={c.channel}>
                        <TableCell>{CHANNEL_LABEL[c.channel] ?? c.channel}</TableCell>
                        <TableCell className="text-right tabular-nums">{int(c.runs)}</TableCell>
                        <TableCell className={c.failed ? "text-right text-rose tabular-nums" : "text-right tabular-nums"}>{int(c.failed)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent failures</CardTitle>
                <CardDescription>Up to 10, newest first</CardDescription>
              </CardHeader>
              <CardContent>
                {s.failures.length === 0 ? (
                  <p className="text-fg-subtle inline-flex items-center gap-1.5 py-4 text-[13px]">
                    <CheckCircle2 className="size-4" aria-hidden /> No failed runs in the last {RANGE_LABEL[range]}.
                  </p>
                ) : (
                  <ul className="divide-line divide-y">
                    {s.failures.map((f) => (
                      <li key={`${f.at}-${f.agent}`} className="py-2.5 first:pt-0 last:pb-0">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                          <AlertTriangle className="size-3.5 shrink-0 translate-y-0.5 text-rose" aria-label="Failed" />
                          <span className="text-fg min-w-0 break-words">{f.task}</span>
                        </p>
                        <p className="mt-0.5 pl-5.5 text-[12.5px] break-words text-rose">{f.error}</p>
                        <p className="text-fg-subtle mt-0.5 pl-5.5 font-mono text-[11px]">
                          {f.agent} · {CHANNEL_LABEL[f.channel] ?? f.channel} · {when.format(new Date(f.at))}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <TracePanels summary={traceSummary} rangeLabel={RANGE_LABEL[range]} source={isRedisConfigured() ? "redis" : "memory"} />

      <p className="text-fg-subtle text-[12px] leading-5">
        {isRedisConfigured() ? "From the shared run log in Upstash Redis" : "From this server instance's memory (Upstash Redis isn't configured)"}, which keeps the
        latest {int(RUN_LOG_LIMIT)} runs.
        {truncated && oldest && ` Older runs have been trimmed, so this view starts at ${when.format(new Date(oldest))}.`}
      </p>
    </PortalShell>
  );
}
