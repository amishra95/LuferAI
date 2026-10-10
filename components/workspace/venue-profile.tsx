"use client";

import { useState } from "react";
import { Bot, Check, Loader2, Receipt, X } from "lucide-react";

import { dispatchBookingAgent, syncExpenseManagement, type AgentBookingRequest } from "@/app/(dashboard)/client/actions";
import { useOptimisticMutation } from "@/components/workspace/use-optimistic-mutation";
import { InspectButton } from "@/components/workspace/inspect";
import { STAGE_LABEL, type LifecycleStatus } from "@/lib/bookings/lifecycle";
import type { AgentBookingOutcome } from "@/lib/bookings/booking-agent";
import { minSpendCompliance } from "@/lib/venues/profile";
import { cn, formatINR } from "@/lib/utils";
import type { VenueAuditEntry, VenueDetail } from "@/types/workspace";

/**
 * The corporate venue profile in the inspector: minimum-spend compliance,
 * seating and private dining, negotiated corporate rates, cancellation terms,
 * a booking-agent dispatch and the venue's booking trail, where approvers and
 * admins can push a booking to the company's expense system.
 *
 * Both mutations are optimistic: the agent's request appears at once as
 * "working", and a sync flips the row; a failure rolls back with a toast.
 */

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const fmtDay = (iso: string) => day.format(new Date(`${iso}T00:00:00+05:30`));
const label = (s: string) => s.replace(/_/g, " ");

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-line border-b px-4 py-4 last:border-b-0">
      <h3 className="label-mono mb-2.5 flex items-center justify-between">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

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

/** A row in a dense mono table. */
function Row({ cells, muted }: { cells: React.ReactNode[]; muted?: boolean }) {
  return (
    <div className={cn("border-line grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b py-1.5 font-mono text-[12px] tabular-nums last:border-b-0", muted && "text-fg-subtle")}>
      {cells.map((c, i) => (
        <span key={i} className={cn(i === 0 ? "text-fg min-w-0 truncate font-sans text-[12.5px]" : "text-right", muted && i === 0 && "text-fg-subtle")}>
          {c}
        </span>
      ))}
    </div>
  );
}

export function VenueProfile({ entity }: { entity: VenueDetail }) {
  const { venue, profile, rates, audit, viewer } = entity;
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const activeRate = rates.find((r) => r.active) ?? null;

  if (!profile) {
    return (
      <Section title="Profile">
        <p className="text-fg-subtle text-[12.5px]">Partner listing from {venue.supplier ?? "a supplier network"}. Seating, rates and terms are agreed with the supplier.</p>
      </Section>
    );
  }

  return (
    <>
      <Section title="Minimum spend">
        <Fields
          rows={[
            ["venue-wide", formatINR(activeRate?.minimumSpendOverride ?? venue.min_spend_inr)],
            ["per guest", profile.minSpendPerHead ? formatINR(profile.minSpendPerHead) : "none"],
            ["capacity", `up to ${venue.capacity_max}`],
            ["alcohol", profile.servesAlcohol ? "served" : "not served"],
            ["entertainment", profile.entertainment.length ? profile.entertainment.map(label).join(", ") : "none"],
          ]}
        />
      </Section>

      <Section title="Seating & private dining">
        {profile.layouts.length === 0 && profile.suites.length === 0 ? (
          <p className="text-fg-subtle text-[12.5px]">No seating plans on file.</p>
        ) : (
          <div>
            {profile.layouts.map((l) => (
              <Row key={l.layout} cells={[label(l.layout), `${l.capacity} seats`, ""]} />
            ))}
            {profile.suites.map((s) => (
              <Row key={s.name} cells={[`${s.name} (private)`, `${s.seats} seats`, `min ${formatINR(s.min_spend_inr)}`]} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Corporate rates">
        {rates.length === 0 ? (
          <p className="text-fg-subtle text-[12.5px]">No negotiated rate{viewer.canBook ? " for your company" : ""}: list pricing applies.</p>
        ) : (
          <div>
            {rates.map((r) => (
              <Row
                key={r.id}
                muted={!r.active}
                cells={[
                  r.company,
                  r.customPerHead != null ? `${formatINR(r.customPerHead)}/head` : `−${r.discountPct}%${r.enterpriseBand ? "" : " ·"}`,
                  r.active ? (r.effectiveTo ? `to ${fmtDay(r.effectiveTo)}` : "open-ended") : r.effectiveFrom > today ? `from ${fmtDay(r.effectiveFrom)}` : "expired",
                ]}
              />
            ))}
            {rates.some((r) => r.customPerHead == null && !r.enterpriseBand) && (
              <p className="text-fg-faint mt-2 text-[11.5px]">· outside the 10–15% enterprise band</p>
            )}
          </div>
        )}
      </Section>

      <Section title="Cancellation">
        <p className="text-fg-muted text-[12.5px] leading-5">{profile.cancellationText}</p>
      </Section>

      {viewer.canBook && <AgentBooking entity={entity} minPerHead={profile.minSpendPerHead} />}

      <Section title="Audit trail" aside={<span className="text-fg-faint normal-case">{audit.length ? `latest ${audit.length}` : ""}</span>}>
        {audit.length === 0 ? (
          <p className="text-fg-subtle text-[12.5px]">No bookings here yet{viewer.canBook ? " for your company" : ""}.</p>
        ) : (
          <ol className="divide-line -mx-1 divide-y">
            {audit.map((a) => (
              <AuditRow key={a.bookingId} entry={a} canSync={viewer.canSyncExpenses} />
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}

const STATUS_DOT: Record<LifecycleStatus, string> = {
  PENDING_APPROVAL: "border border-warn",
  PENDING: "bg-warn",
  CONFIRMED: "bg-fg",
  COMPLETED: "bg-sage",
  SETTLED: "border border-sage",
  CANCELLED: "bg-rose",
};

/** One booking: lifecycle stage, contents, expense status; sync for approvers and admins. */
function AuditRow({ entry: server, canSync }: { entry: VenueAuditEntry; canSync: boolean }) {
  const { value: entry, mutate, pending } = useOptimisticMutation(server);
  const syncable = canSync && (entry.status === "CONFIRMED" || entry.status === "COMPLETED") && entry.expense?.status !== "delivered" && entry.expense?.status !== "mocked";
  // Completed and already exported: a sync only settles it.
  const settleOnly = canSync && entry.status === "COMPLETED" && (entry.expense?.status === "delivered" || entry.expense?.status === "mocked");

  const sync = () =>
    mutate({
      apply: (e) => ({ ...e, expense: { provider: e.expense?.provider ?? "…", status: "syncing", attempts: (e.expense?.attempts ?? 0) + 1 }, ...(e.status === "COMPLETED" && { status: "SETTLED" as const }) }),
      action: () => syncExpenseManagement(entry.bookingId),
      commit: (e, r) => ({
        ...e,
        expense: { provider: r.provider, status: r.export === "skipped" ? (e.expense?.status === "syncing" ? "delivered" : (e.expense?.status ?? "delivered")) : r.export, attempts: e.expense?.attempts ?? 1 },
        ...(r.settled && { status: "SETTLED" as const, settledAt: new Date().toISOString() }),
      }),
      failure: "Expense sync failed",
      success: (r) =>
        r.export === "failed"
          ? { tone: "error", title: `${r.provider} rejected the expense`, description: r.error }
          : { tone: "success", title: r.settled ? "Booking settled" : "Expense synced", description: `${r.provider} · ${r.export}` },
    });

  return (
    <li className="px-1 py-2">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className={cn("status-dot", STATUS_DOT[entry.status])} aria-hidden />
        <span className="text-fg">{STAGE_LABEL[entry.status]}</span>
        <span className="text-fg-subtle font-mono text-[11.5px] tabular-nums">
          {fmtDay(entry.eventDate)} · {entry.partySize} pax · {formatINR(entry.total)}
        </span>
        {(syncable || settleOnly) && (
          <button type="button" onClick={() => void sync()} disabled={pending} className="btn ml-auto h-6 px-2 text-[11.5px]" title="Export to the company's expense system">
            {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Receipt className="size-3" aria-hidden />}
            {settleOnly ? "Settle" : entry.expense?.status === "failed" ? "Retry sync" : "Sync expense"}
          </button>
        )}
      </div>
      <p className="text-fg-faint mt-0.5 pl-3.5 font-mono text-[11px]">
        {entry.company && `${entry.company} · `}
        {[entry.alcohol && "alcohol", ...entry.entertainment.map(label)].filter(Boolean).join(", ") || "no extras"}
        {entry.expense && ` · ${entry.expense.provider} ${entry.expense.status}${entry.expense.attempts > 1 ? ` ×${entry.expense.attempts}` : ""}`}
        {` · updated ${when.format(new Date(entry.settledAt ?? entry.at))}`}
      </p>
    </li>
  );
}

// ----------------------------------------------------------------------------
// Booking agent
// ----------------------------------------------------------------------------

type AgentRun = { key: string; request: AgentBookingRequest; outcome: AgentBookingOutcome | null };

const OUTCOME: Record<AgentBookingOutcome["status"], string> = {
  confirmed: "Confirmed",
  with_venue: "Sent to venue",
  awaiting_approval: "Awaiting approval",
  failed: "Not booked",
};

const ENTERTAINMENT_OPTIONS = ["live_music", "dj", "karaoke", "comedy", "games"];

/**
 * Hands an event to the booking agent for this venue. The request shows as
 * "working" at once (optimistic); the outcome replaces it, or a failed dispatch
 * removes it with a toast.
 */
function AgentBooking({ entity, minPerHead }: { entity: VenueDetail; minPerHead: number }) {
  // A stable empty list: a fresh [] each render would reset the base every render.
  const [noRuns] = useState<AgentRun[]>(() => []);
  const { value: runs, mutate } = useOptimisticMutation(noRuns);
  const [error, setError] = useState<string | null>(null);
  const venue = entity.venue;
  // Read once, not on every render.
  const [tomorrow] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const request: AgentBookingRequest = {
      venueId: venue.id,
      eventDate: String(f.get("date") ?? ""),
      partySize: Number(f.get("guests")),
      perHead: Number(f.get("per_head")),
      maxPerHead: Number(f.get("max_per_head") || f.get("per_head")),
      alcoholIncluded: f.get("alcohol") === "on",
      entertainment: f.getAll("entertainment").map(String),
      privateDining: f.get("private") === "on",
      costCenter: String(f.get("cost_center") ?? ""),
    };
    // Quick checks here; the server re-validates everything.
    if (!request.eventDate || !(request.partySize > 0) || !(request.perHead > 0) || !request.costCenter.trim()) {
      setError("Date, guests, per-head budget and cost centre are required.");
      return;
    }
    if (request.partySize > venue.capacity_max) {
      setError(`${venue.name} seats up to ${venue.capacity_max}.`);
      return;
    }
    setError(null);
    const key = crypto.randomUUID();
    void mutate({
      apply: (list) => [{ key, request, outcome: null }, ...list],
      action: () => dispatchBookingAgent(request),
      commit: (list, outcome) => [{ key, request, outcome }, ...list],
      failure: "The booking agent couldn't start",
      success: (o) =>
        o.status === "failed"
          ? { tone: "error", title: "Booking agent: not booked", description: o.message }
          : { tone: "success", title: `Booking agent: ${OUTCOME[o.status].toLowerCase()}`, description: o.message },
    });
  }

  const compliance = (guests: number, perHead: number) =>
    minSpendCompliance({ partySize: guests, perHead, minimumSpend: venue.min_spend_inr, minimumPerHead: minPerHead });

  return (
    <Section title="Book with agent">
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 text-[12px]">
        <label className="col-span-2 grid gap-1">
          <span className="text-fg-subtle">Date</span>
          <input name="date" type="date" min={tomorrow} required className="field h-8 font-mono" />
        </label>
        <label className="grid gap-1">
          <span className="text-fg-subtle">Guests</span>
          <input name="guests" type="number" min={1} max={venue.capacity_max} required className="field h-8 font-mono" />
        </label>
        <label className="grid gap-1">
          <span className="text-fg-subtle">Cost centre</span>
          <input name="cost_center" required maxLength={40} className="field h-8 font-mono" />
        </label>
        <label className="grid gap-1">
          <span className="text-fg-subtle">Per head ₹</span>
          <input name="per_head" type="number" min={1} step={1} required placeholder={minPerHead ? String(minPerHead) : undefined} className="field h-8 font-mono" />
        </label>
        <label className="grid gap-1">
          <span className="text-fg-subtle">Up to ₹</span>
          <input name="max_per_head" type="number" min={1} step={1} placeholder="same" className="field h-8 font-mono" />
        </label>
        <fieldset className="col-span-2 flex flex-wrap gap-x-3 gap-y-1.5 pt-1">
          <legend className="sr-only">Includes</legend>
          <label className="text-fg-muted flex items-center gap-1.5">
            <input type="checkbox" name="alcohol" className="accent-fg size-3.5" /> alcohol
          </label>
          <label className="text-fg-muted flex items-center gap-1.5">
            <input type="checkbox" name="private" className="accent-fg size-3.5" /> private room
          </label>
          {ENTERTAINMENT_OPTIONS.filter((e) => entity.profile?.entertainment.includes(e)).map((e) => (
            <label key={e} className="text-fg-muted flex items-center gap-1.5">
              <input type="checkbox" name="entertainment" value={e} className="accent-fg size-3.5" /> {label(e)}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-rose col-span-2 text-[12px]">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary col-span-2 h-8 text-[12px]">
          <Bot className="size-3.5" aria-hidden /> Dispatch booking agent
        </button>
        <p className="text-fg-faint col-span-2 text-[11.5px] leading-4">
          Checks availability, applies your company&apos;s rate, raises the offer up to your ceiling only to meet the venue&apos;s minimum, and follows your
          spend policy. It confirms on its own only in-policy bookings on pre-agreed corporate terms.
        </p>
      </form>

      {runs.length > 0 && (
        <ol className="mt-3 space-y-2" aria-live="polite">
          {runs.map((r) => (
            <li key={r.key} className="border-line rounded-md border px-3 py-2">
              <p className="flex items-center gap-2 text-[12.5px]">
                {r.outcome === null ? (
                  <Loader2 className="text-fg-subtle size-3 animate-spin" aria-hidden />
                ) : r.outcome.status === "failed" ? (
                  <X className="text-rose size-3" strokeWidth={2.5} aria-hidden />
                ) : (
                  <Check className="text-sage size-3" strokeWidth={2.5} aria-hidden />
                )}
                <span className="text-fg">{r.outcome ? OUTCOME[r.outcome.status] : "Agent working…"}</span>
                <span className="text-fg-subtle ml-auto font-mono text-[11px] tabular-nums">
                  {r.request.partySize} pax · {fmtDay(r.request.eventDate)}
                </span>
              </p>
              {r.outcome === null && !compliance(r.request.partySize, r.request.perHead).ok && (
                <p className="text-fg-faint mt-1 font-mono text-[11px]">below the venue minimum at ₹{r.request.perHead}/head; the agent will try to raise it</p>
              )}
              {r.outcome && (
                <>
                  <ol className="text-fg-subtle mt-1.5 space-y-0.5 font-mono text-[11px]">
                    {r.outcome.steps.map((s, i) => (
                      <li key={i} className={cn(!s.ok && "text-rose")}>
                        {s.ok ? "✓" : "✗"} {s.step}: {s.detail}
                      </li>
                    ))}
                  </ol>
                  {r.outcome.traceId && (
                    <InspectButton kind="trace" id={r.outcome.traceId} className="text-fg-faint mt-1 font-mono text-[10.5px]">
                      trace {r.outcome.traceId.slice(0, 12)}
                    </InspectButton>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
