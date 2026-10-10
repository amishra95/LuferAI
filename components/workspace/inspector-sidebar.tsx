"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, Copy, Loader2, X } from "lucide-react";

import { TraceWaterfall } from "@/components/admin/trace-waterfall";
import { AgentStatusBadge } from "@/components/agents/agent-row";
import { InspectButton } from "@/components/workspace/inspect";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { formatMs } from "@/lib/telemetry/format";
import { cn, formatINR } from "@/lib/utils";
import type { EntityKind, EntityRef } from "@/lib/workspace/state";
import type { AgentDetail, InspectedEntity, RunDetail, TraceDetail, VenueDetail } from "@/types/workspace";

/**
 * Global entity inspector: a right-hand panel the dashboard shell renders on
 * every route. It shows whatever the workspace context is inspecting, loaded
 * from /api/workspace/inspect, so opening it never navigates.
 *
 * Docked beside the page from lg up (the page reflows), a full-height overlay
 * below that. Escape closes it.
 */

const KIND_TITLE: Record<EntityKind, string> = { agent: "Agent", venue: "Venue", trace: "Trace", run: "Run" };
const CHANNEL_LABEL: Record<string, string> = { web: "Web app", whatsapp: "WhatsApp", slack: "Slack" };

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const int = (n: number) => n.toLocaleString("en-IN");

type Load = { ref: EntityRef; status: "ok"; entity: InspectedEntity } | { ref: EntityRef; status: "error"; message: string };

const ERROR_TEXT: Record<number, string> = {
  401: "Sign in to inspect this.",
  403: "You don't have access to this.",
  404: "Not found. It may have aged out of the run log or trace store.",
};

/** Where the full view of an entity lives. */
function pageHref(entity: InspectedEntity): { href: string; label: string } {
  switch (entity.kind) {
    case "agent":
      return entity.config ? { href: "/agents", label: "Open agents" } : { href: "/admin/analytics", label: "Open analytics" };
    case "venue":
      return { href: `/venues?${new URLSearchParams({ q: entity.venue.name })}`, label: "Open in directory" };
    case "trace":
    case "run":
      return { href: "/admin/analytics", label: "Open analytics" };
  }
}

export function InspectorSidebar() {
  const { state, closeInspector } = useWorkspace();
  const ref = state.inspecting;
  const panel = useRef<HTMLElement>(null);
  const [load, setLoad] = useState<Load | null>(null);
  const [reload, setReload] = useState(0);

  const kind = ref?.kind;
  const id = ref?.id;
  useEffect(() => {
    if (!kind || !id) return;
    const ctrl = new AbortController();
    const current = { kind, id };
    fetch(`/api/workspace/inspect?${new URLSearchParams({ kind, id })}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (r.ok) return setLoad({ ref: current, status: "ok", entity: (await r.json()) as InspectedEntity });
        setLoad({ ref: current, status: "error", message: ERROR_TEXT[r.status] ?? "Couldn't load this right now." });
      })
      .catch(() => !ctrl.signal.aborted && setLoad({ ref: current, status: "error", message: "Couldn't load this right now." }));
    return () => ctrl.abort();
  }, [kind, id, reload]);

  // Escape closes, unless a dialog (the palette, a config form) is on top and handles it.
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[aria-modal='true'], dialog[open]")) return;
      closeInspector();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, closeInspector]);

  // Move focus into the panel when it opens, so keyboard users land in it.
  const isOpen = Boolean(kind);
  useEffect(() => {
    if (isOpen) panel.current?.focus({ preventScroll: true });
  }, [isOpen]);

  if (!ref) return null;
  // Results for an earlier entity are never shown for this one.
  const current = load && load.ref.kind === ref.kind && load.ref.id === ref.id ? load : null;

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={`${KIND_TITLE[ref.kind]} inspector`}
      className={cn(
        "bg-canvas border-line animate-in slide-in-from-right fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l outline-none duration-150 sm:w-[26rem]",
        "lg:static lg:z-auto lg:w-[24rem] lg:shrink-0 xl:w-[28rem]"
      )}
    >
      <header className="border-line flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <span className="label-mono">{KIND_TITLE[ref.kind]}</span>
        <span className="text-fg-muted min-w-0 truncate font-mono text-[11.5px]" title={ref.id}>
          {ref.id}
        </span>
        <CopyId id={ref.id} />
        <button type="button" onClick={closeInspector} aria-label="Close inspector" title="Close (esc)" className="btn btn-ghost btn-icon ml-auto size-8">
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={!current}>
        {!current ? (
          <p className="text-fg-subtle flex items-center gap-2 px-4 py-6 font-mono text-[11.5px]">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> loading…
          </p>
        ) : current.status === "error" ? (
          <div className="px-4 py-6">
            <p className="text-fg-muted flex items-start gap-2 text-[13px]">
              <AlertTriangle className="text-rose mt-0.5 size-3.5 shrink-0" aria-hidden />
              {current.message}
            </p>
            <button type="button" onClick={() => setReload((n) => n + 1)} className="btn mt-4 h-7 px-2.5 text-[12px]">
              Retry
            </button>
          </div>
        ) : (
          <EntityBody entity={current.entity} />
        )}
      </div>

      {current?.status === "ok" && (
        <footer className="border-line flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
          <Link href={pageHref(current.entity).href} className="btn h-7 px-2.5 text-[12px]">
            {pageHref(current.entity).label}
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
          <button type="button" onClick={() => setReload((n) => n + 1)} className="btn btn-ghost h-7 px-2.5 text-[12px]">
            Refresh
          </button>
        </footer>
      )}
    </aside>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={copied ? "Copied" : "Copy id"}
      title="Copy id"
      className="btn btn-ghost btn-icon size-6 shrink-0"
    >
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
    </button>
  );
}

function EntityBody({ entity }: { entity: InspectedEntity }) {
  switch (entity.kind) {
    case "agent":
      return <AgentBody entity={entity} />;
    case "venue":
      return <VenueBody entity={entity} />;
    case "trace":
      return <TraceBody entity={entity} />;
    case "run":
      return <RunBody run={entity.run} />;
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-line border-b px-4 py-4 last:border-b-0">
      <h3 className="label-mono mb-2.5">{title}</h3>
      {children}
    </section>
  );
}

/** Dense key/value grid: mono values, labels in the faint column. */
function Fields({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-subtle">{k}</dt>
          <dd className="text-fg min-w-0 font-mono text-[12px] break-words tabular-nums">{v ?? <span className="text-fg-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Title({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="border-line flex items-start justify-between gap-3 border-b px-4 py-4">
      <div className="min-w-0">{children}</div>
      {aside}
    </div>
  );
}

function RunStatus({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="pill">
      <Check className="text-sage size-2.5" strokeWidth={3} aria-hidden /> ok
    </span>
  ) : (
    <span className="pill border-rose/25 bg-rose/[0.06] text-rose">
      <X className="size-2.5" strokeWidth={3} aria-hidden /> failed
    </span>
  );
}

function RunList({ runs }: { runs: RunDetail[] }) {
  if (runs.length === 0) return <p className="text-fg-subtle text-[12.5px]">No runs in the recent log.</p>;
  return (
    <ul className="divide-line -mx-1 divide-y">
      {runs.map((r) => (
        <li key={r.id} className="flex items-center gap-2.5 px-1 py-2 text-[12.5px]">
          {r.ok ? <Check className="text-sage size-3 shrink-0" strokeWidth={2.5} aria-label="ok" /> : <X className="text-rose size-3 shrink-0" strokeWidth={2.5} aria-label="failed" />}
          <InspectButton kind="run" id={r.id} label={r.task} className="text-fg-muted min-w-0 flex-1 truncate">
            {r.task}
          </InspectButton>
          <span className="text-fg-subtle shrink-0 font-mono text-[11px] tabular-nums">{formatMs(r.durationMs)}</span>
        </li>
      ))}
    </ul>
  );
}

function AgentBody({ entity }: { entity: AgentDetail }) {
  const { config } = entity;
  return (
    <>
      <Title aside={entity.status && <AgentStatusBadge status={entity.status} />}>
        <p className="text-fg text-[14px] font-semibold tracking-[-0.01em]">{config?.name ?? entity.id}</p>
        <p className="text-fg-subtle mt-0.5 text-[12.5px]">{config?.description ?? "Single-purpose AI route. No settings; runs only."}</p>
      </Title>
      {config && (
        <Section title="Config">
          <Fields
            rows={[
              ["enabled", config.enabled ? "yes" : "no"],
              ["tools", config.tools.join(", ")],
              ["temperature", config.temperature ?? "auto"],
              ["max steps", config.maxSteps],
            ]}
          />
        </Section>
      )}
      <Section title="Activity">
        <Fields
          rows={[
            ["runs", int(entity.runCount)],
            ["last run", entity.lastRun ? when.format(new Date(entity.lastRun.at)) : "never"],
            ["last result", entity.lastRun ? (entity.lastRun.ok ? "ok" : (entity.lastRun.error ?? "failed")) : null],
          ]}
        />
      </Section>
      <Section title="Recent runs">
        <RunList runs={entity.recentRuns} />
      </Section>
    </>
  );
}

function VenueBody({ entity: { venue } }: { entity: VenueDetail }) {
  return (
    <>
      <Title aside={<span className="pill">{venue.tier === "internal" ? "Lufer.ai" : "partner"}</span>}>
        <p className="text-fg text-[14px] font-semibold tracking-[-0.01em]">{venue.name}</p>
        <p className="text-fg-subtle mt-0.5 text-[12.5px]">{venue.address || `${venue.neighborhood}, ${venue.city}`}</p>
      </Title>
      <Section title="Listing">
        <Fields
          rows={[
            ["area", `${venue.neighborhood}, ${venue.city}`],
            ["guests", `up to ${venue.capacity_max}`],
            ["min spend", formatINR(venue.min_spend_inr)],
            ["private dining", venue.pdr_available ? "yes" : "no"],
            ["booking", venue.bookable ? "direct" : `quote via ${venue.supplier ?? "supplier"}`],
          ]}
        />
      </Section>
      <Section title="Commercial">
        <Fields
          rows={[
            ["GSTIN", venue.gstin],
            ["commission", venue.commission_rate === null ? null : `${(venue.commission_rate * 100).toFixed(1)}%`],
            ["supplier", venue.supplier],
          ]}
        />
      </Section>
    </>
  );
}

function TraceBody({ entity: { trace } }: { entity: TraceDetail }) {
  const failed = trace.spans.slice(1).find((s) => s.status === "error") ?? (trace.status === "error" ? trace.spans[0] : undefined);
  return (
    <>
      <Title aside={<RunStatus ok={trace.status === "ok"} />}>
        <p className="text-fg font-mono text-[13px] font-medium">{trace.name}</p>
        <p className="text-fg-subtle mt-0.5 font-mono text-[11.5px] tabular-nums">
          {when.format(new Date(trace.start))} · {formatMs(trace.durationMs)} · {trace.spans.length} span{trace.spans.length === 1 ? "" : "s"}
          {trace.droppedSpans > 0 && ` (+${trace.droppedSpans} dropped)`}
        </p>
      </Title>
      {failed?.error && (
        <Section title="Root cause">
          <p className="text-rose font-mono text-[12px] break-words">
            {failed.name}: {failed.error.name}: {failed.error.message}
          </p>
        </Section>
      )}
      <Section title="Spans">
        <TraceWaterfall trace={trace} />
      </Section>
    </>
  );
}

function RunBody({ run }: { run: RunDetail }) {
  return (
    <>
      <Title aside={<RunStatus ok={run.ok} />}>
        <p className="text-fg text-[14px] font-medium">{run.task}</p>
        <p className="text-fg-subtle mt-0.5 font-mono text-[11.5px] tabular-nums">{when.format(new Date(run.at))}</p>
      </Title>
      {run.error && (
        <Section title="Error">
          <p className="text-rose font-mono text-[12px] break-words">{run.error}</p>
        </Section>
      )}
      <Section title="Run">
        <Fields
          rows={[
            [
              "agent",
              <InspectButton key="agent" kind="agent" id={run.agent}>
                {run.agent}
              </InspectButton>,
            ],
            ["source", run.source],
            ["channel", CHANNEL_LABEL[run.channel] ?? run.channel],
            ["duration", formatMs(run.durationMs)],
            ["tokens", int(run.tokens)],
            ["steps", run.steps],
          ]}
        />
      </Section>
    </>
  );
}
