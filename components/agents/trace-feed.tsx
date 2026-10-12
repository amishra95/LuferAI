import Link from "next/link";
import { ArrowUpRight, CornerDownRight, Filter, Handshake, LifeBuoy, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/portal/empty-state";
import { Pill, type PillTone } from "@/components/portal/pills";
import { cn } from "@/lib/utils";
import type { ObservabilityEvent, TraceKind, TraceOutcome } from "@/types/agents";

export type KindFilter = TraceKind | "all";
export type OutcomeFilter = TraceOutcome | "all";

export const KINDS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "negotiation", label: "Negotiation" },
  { value: "guardrail", label: "Guardrails" },
  { value: "prompt", label: "Prompt calls" },
];

export const OUTCOMES: { value: OutcomeFilter; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "success", label: "Success" },
  { value: "auto-counter", label: "Auto-Counter" },
  { value: "auto-decline", label: "Auto-Decline" },
  { value: "fallback", label: "Error/Fallback" },
];

const OUTCOME: Record<TraceOutcome, { tone: PillTone; label: string; hint: string }> = {
  success: { tone: "ok", label: "Success", hint: "Completed as asked" },
  "auto-counter": { tone: "warn", label: "Auto-Counter", hint: "Countered automatically within the venue's negotiation rules" },
  "auto-decline": { tone: "neutral", label: "Auto-Decline", hint: "Declined or refused by a deterministic rule" },
  fallback: { tone: "error", label: "Error/Fallback", hint: "Failed; a manual path takes over" },
};

const KIND: Record<TraceKind, { label: string; icon: LucideIcon }> = {
  negotiation: { label: "negotiation", icon: Handshake },
  guardrail: { label: "guardrail", icon: ShieldCheck },
  prompt: { label: "prompt call", icon: ScrollText },
};

export function OutcomeBadge({ outcome }: { outcome: TraceOutcome }) {
  const o = OUTCOME[outcome];
  return (
    <Pill tone={o.tone} title={o.hint}>
      {o.label}
    </Pill>
  );
}

// Server-rendered, so a fixed zone keeps output stable; IST matches the business.
const CLOCK = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

function formatAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

const formatDuration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function href(kind: KindFilter, outcome: OutcomeFilter) {
  const q = new URLSearchParams();
  if (kind !== "all") q.set("kind", kind);
  if (outcome !== "all") q.set("outcome", outcome);
  const s = q.toString();
  return `/agents${s ? `?${s}` : ""}#activity`;
}

/** Segmented links (?kind=…&outcome=…): filtering works without JS, survives refresh and can be shared. */
function Segmented<T extends string>({
  label,
  options,
  value,
  counts,
  to,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  counts: Record<T, number>;
  to: (v: T) => string;
}) {
  return (
    <nav aria-label={label} className="bg-surface-raised inline-flex max-w-full overflow-x-auto rounded-[10px] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Link
            key={o.value}
            href={to(o.value)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] whitespace-nowrap transition-colors",
              active ? "bg-surface text-fg font-medium ring-1 ring-line" : "text-fg-subtle hover:text-fg"
            )}
          >
            {o.label}
            <span className={cn("font-mono text-[10.5px] tabular-nums", active ? "text-fg-subtle" : "text-fg-faint")}>{counts[o.value]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const AGENT_NAME: Record<string, string> = {
  "property-negotiator": "Property negotiator",
  "rfp-broadcaster": "RFP broadcaster",
  "venue-sourcer": "Venue sourcer",
  "brief-writer": "Brief writer",
  "channel-concierge": "Channel concierge",
  "workspace-agent": "Workspace agent",
  "metrics-reporter": "Metrics reporter",
  host: "Venue host",
};

function EventRow({ e, now }: { e: ObservabilityEvent; now: number }) {
  const { icon: Icon, label } = KIND[e.kind];
  return (
    <li className="border-line hover:bg-surface-hover border-b px-5 py-3.5 transition-colors last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="border-line bg-canvas mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border" title={label}>
          <Icon className="text-fg-muted size-3.5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <OutcomeBadge outcome={e.outcome} />
            <p className="text-fg min-w-0 truncate text-[13px] font-medium" title={e.title}>
              {e.title}
            </p>
          </div>
          <p className="text-fg-subtle mt-1 text-[12.5px] leading-5">{e.detail}</p>
          <div className="text-fg-faint mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
            <span className="text-fg-subtle">
              {label} · {AGENT_NAME[e.agent] ?? e.agent}
            </span>
            {e.manual && <span className="text-fg-subtle">human-in-the-loop</span>}
            {e.facts.map(([k, v]) => (
              <span key={k}>
                {k} <span className="text-fg-muted">{v}</span>
              </span>
            ))}
            {e.tokens ? <span>{e.tokens.toLocaleString("en-IN")} tok</span> : null}
            {e.traceId && <span title="Trace id (spans and timings on /admin/analytics)">trace {e.traceId.slice(0, 8)}</span>}
          </div>
          {e.fallback && (
            <p className="border-line text-fg-muted mt-2 flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-[12px] leading-5">
              <CornerDownRight className="text-fg-subtle mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="label-mono mr-1.5">manual path</span>
                {e.fallback}
              </span>
            </p>
          )}
        </div>
        <div className="shrink-0 text-right font-mono text-[11px] tabular-nums">
          <time dateTime={e.at} title={`${CLOCK.format(new Date(e.at))} IST`} className="text-fg-subtle block">
            {formatAgo(e.at, now)}
          </time>
          {e.durationMs !== null && <span className="text-fg-faint block">{formatDuration(e.durationMs)}</span>}
        </div>
      </div>
    </li>
  );
}

/** Zero state: what produces each kind of row, and where to trigger it. */
function NoActivity({ kind }: { kind: KindFilter }) {
  const what =
    kind === "negotiation"
      ? "No negotiation steps recorded yet."
      : kind === "guardrail"
        ? "No guardrail decisions recorded yet."
        : kind === "prompt"
          ? "No prompt calls recorded yet."
          : "No agent activity recorded yet.";
  return (
    <div className="p-5">
      <EmptyState
        icon={ScrollText}
        compact
        title={what}
        description="Rows appear as agents run. Traces live in Upstash Redis when it's configured (otherwise in this server's memory, cleared on restart), so a fresh instance starts empty."
        action={
          <>
            <Link href="/client" className="btn h-8 px-3 text-[12.5px]">
              Open /client <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
            <Link href="/property" className="btn h-8 px-3 text-[12.5px]">
              Open /property <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </>
        }
      />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <TriggerCard
          surface="/client"
          steps={[
            ["Broadcast an RFP from a brief", "One prompt call reads the brief, then every matching venue answers instantly: a quote (Success), the venue's auto-counter at the client's budget (Auto-Counter), or an auto-decline or no-fit (Auto-Decline)."],
            ["Search venues in plain English", "A prompt call turns the request into catalogue filters."],
          ]}
        />
        <TriggerCard
          surface="/property"
          steps={[
            ["Ask the negotiator to change pricing", "Reads run freely; minimum-spend and menu-package writes wait for the host's approval, then pass the guardrails (allowed, or Auto-Decline)."],
            ["Counter or decline from the RFP inbox", "Logged as a human-in-the-loop step; a counter below the venue's floor or past its discount ceiling shows as Auto-Decline."],
            ["Generate an event brief", "One prompt call per booking."],
          ]}
        />
      </div>
      <p className="text-fg-subtle mt-3 text-[12px] leading-5">
        WhatsApp and Slack messages run the channel concierge, whose bookings pass the createBooking guardrail. The Test button on an agent above logs a tool smoke test without calling the model.
      </p>
    </div>
  );
}

function TriggerCard({ surface, steps }: { surface: string; steps: [string, string][] }) {
  return (
    <div className="border-line rounded-lg border px-4 py-3">
      <p className="label-mono mb-2">triggers on {surface}</p>
      <ol className="space-y-2">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-2.5 text-[12.5px] leading-5">
            <span className="text-fg-faint font-mono text-[11px] tabular-nums">{i + 1}</span>
            <span>
              <span className="text-fg">{title}</span>
              <span className="text-fg-subtle block">{body}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TraceFeed({
  events,
  kind,
  outcome,
  now,
  errors,
}: {
  events: ObservabilityEvent[];
  kind: KindFilter;
  outcome: OutcomeFilter;
  now: number;
  errors: string[];
}) {
  const byKind = kind === "all" ? events : events.filter((e) => e.kind === kind);
  const visible = outcome === "all" ? byKind : byKind.filter((e) => e.outcome === outcome);
  const kindCounts = Object.fromEntries(KINDS.map((k) => [k.value, k.value === "all" ? events.length : events.filter((e) => e.kind === k.value).length])) as Record<KindFilter, number>;
  const outcomeCounts = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.value === "all" ? byKind.length : byKind.filter((e) => e.outcome === o.value).length])) as Record<OutcomeFilter, number>;
  const shown = visible.slice(0, 100);

  return (
    <section id="activity" aria-labelledby="activity-heading" className="scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="activity-heading" className="text-fg text-[15px] font-semibold tracking-tight">
            Trace &amp; execution log
          </h2>
          <p className="text-fg-subtle mt-0.5 text-[12.5px]">Negotiation steps, guardrail decisions and prompt calls, newest first.</p>
        </div>
        {errors.length > 0 && (
          <span className="text-rose font-mono text-[11px]" role="status">
            partial: {errors.join(", ")}
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Segmented label="Filter by activity type" options={KINDS} value={kind} counts={kindCounts} to={(k) => href(k, outcome)} />
        <Segmented label="Filter by status" options={OUTCOMES} value={outcome} counts={outcomeCounts} to={(o) => href(kind, o)} />
      </div>

      <div className="panel overflow-hidden">
        {byKind.length === 0 ? (
          <NoActivity kind={kind} />
        ) : visible.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={outcome === "fallback" ? LifeBuoy : Filter}
              compact
              title={outcome === "fallback" ? "No errors or fallbacks" : `No ${OUTCOME[outcome as TraceOutcome].label} rows here`}
              description={
                outcome === "fallback"
                  ? "Every recorded model call and rule check in this view completed. Failures land here with the manual path that took over."
                  : `${OUTCOME[outcome as TraceOutcome].hint}. None of the ${byKind.length} recorded ${kind === "all" ? "" : `${KINDS.find((k) => k.value === kind)!.label.toLowerCase()} `}rows match.`
              }
              action={
                <Link href={href(kind, "all")} scroll={false} className="btn h-8 px-3 text-[12.5px]">
                  Show any status
                </Link>
              }
            />
          </div>
        ) : (
          <ul>
            {shown.map((e) => (
              <EventRow key={e.id} e={e} now={now} />
            ))}
          </ul>
        )}
      </div>
      {visible.length > shown.length && (
        <p className="text-fg-subtle mt-2 font-mono text-[11px]">
          Showing the newest {shown.length} of {visible.length}.
        </p>
      )}
    </section>
  );
}
