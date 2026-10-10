"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { createPurchaseOrderAction, reallocateBookingAction, setPurchaseOrderStatusAction } from "../po-actions";
import { useOptimisticMutation } from "@/components/workspace/use-optimistic-mutation";
import { ineligibility, ledger, poBalance, subjectOf, validateNewPo, type NewPoInput } from "@/lib/procurement/po-ledger";
import type { PoAllocation, PurchaseOrder } from "@/lib/supabase/database.types";
import { cn, formatINR } from "@/lib/utils";

/**
 * The Purchase orders tab: each blanket PO with its balance and allocation
 * ledger, plus raising, closing/reopening and moving a booking's spend to
 * another PO (Approvers and admins). State is held optimistically; balances
 * are recomputed client-side with the same rules the server enforces
 * (lib/procurement/po-ledger.ts), so a change shows at once and a refusal
 * rolls back with the reason.
 */

/** A booking or a catalogue order, as the ledger labels it. */
export interface LedgerBooking {
  id: string;
  kind: "booking" | "order";
  label: string;
  status: string;
  /** Plain-language stage ("With the venue", "Shipped", …). */
  statusLabel: string;
  eventDate: string;
  departmentId: string | null;
}

type State = { pos: PurchaseOrder[]; allocations: PoAllocation[] };

const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const fmtDay = (iso: string) => day.format(new Date(`${iso}T00:00:00+05:30`));

export function PoLedger({
  companyId,
  pos,
  allocations,
  bookings,
  departments,
  canManage,
}: {
  companyId: string;
  pos: PurchaseOrder[];
  allocations: PoAllocation[];
  bookings: LedgerBooking[];
  departments: { id: string; name: string }[];
  canManage: boolean;
}) {
  // Stable while the props are: a new object every render would reset the base every render.
  const server = useMemo(() => ({ pos, allocations }), [pos, allocations]);
  const { value: state, mutate } = useOptimisticMutation<State>(server);
  const deptName = (id: string | null) => (id ? (departments.find((d) => d.id === id)?.name ?? "a department") : "Company-wide");
  const unallocated = bookings.filter((b) => b.kind === "booking" && b.status !== "CANCELLED" && !state.allocations.some((a) => subjectOf(a) === b.id));

  const setStatus = (po: PurchaseOrder, status: "open" | "closed") =>
    mutate({
      apply: (s) => ({ ...s, pos: s.pos.map((p) => (p.id === po.id ? { ...p, status } : p)) }),
      action: () => setPurchaseOrderStatusAction(companyId, po.id, status),
      commit: (s, saved) => ({ ...s, pos: s.pos.map((p) => (p.id === saved.id ? saved : p)) }),
      failure: `Couldn't ${status === "closed" ? "close" : "reopen"} ${po.po_number}`,
      success: () => ({ tone: "success", title: `${po.po_number} ${status === "closed" ? "closed" : "reopened"}` }),
    });

  const reallocate = (bookingId: string, poId: string) => {
    const target = state.pos.find((p) => p.id === poId);
    const booking = bookings.find((b) => b.id === bookingId);
    return mutate({
      apply: (s) => {
        const existing = s.allocations.find((a) => a.booking_id === bookingId);
        if (existing) return { ...s, allocations: s.allocations.map((a) => (a.booking_id === bookingId ? { ...a, po_id: poId, over_balance: false } : a)) };
        return s; // a new allocation's amount comes from the server
      },
      action: () => reallocateBookingAction(companyId, bookingId, poId),
      commit: (s, saved) => ({ ...s, allocations: [...s.allocations.filter((a) => a.booking_id !== saved.booking_id), saved] }),
      failure: `Couldn't move ${booking?.label ?? "the booking"} to ${target?.po_number ?? "that PO"}`,
      success: () => ({ tone: "success", title: `Moved to ${target?.po_number}` }),
    });
  };

  return (
    <div className="space-y-4">
      {state.pos.length === 0 ? (
        <div className="panel text-fg-subtle px-5 py-6 text-[13px]">
          No purchase orders yet. Without one, bookings aren&apos;t checked against a PO.{canManage && " Raise one below to start tracking spend against it."}
        </div>
      ) : (
        state.pos
          .slice()
          .sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || a.valid_to.localeCompare(b.valid_to))
          .map((po) => (
            <PoPanel
              key={po.id}
              po={po}
              state={state}
              bookings={bookings}
              scope={deptName(po.department_id)}
              canManage={canManage}
              onStatus={(status) => void setStatus(po, status)}
              onReallocate={(bookingId, poId) => void reallocate(bookingId, poId)}
            />
          ))
      )}

      {canManage && unallocated.length > 0 && state.pos.some((p) => p.status === "open") && (
        <section className="panel px-5 py-4">
          <h3 className="label-mono mb-2">Not on a PO</h3>
          <ul className="divide-line divide-y">
            {unallocated.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2 text-[12.5px]">
                <span className="text-fg min-w-0 flex-1 truncate">{b.label}</span>
                <span className="text-fg-subtle font-mono text-[11.5px]">{b.statusLabel}</span>
                <PoSelect booking={b} state={state} onPick={(poId) => void reallocate(b.id, poId)} placeholder="Allocate to…" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && <NewPoForm companyId={companyId} departments={departments} existing={state.pos.map((p) => p.po_number)} mutate={mutate} />}
    </div>
  );
}

function PoPanel({
  po,
  state,
  bookings,
  scope,
  canManage,
  onStatus,
  onReallocate,
}: {
  po: PurchaseOrder;
  state: State;
  bookings: LedgerBooking[];
  scope: string;
  canManage: boolean;
  onStatus: (status: "open" | "closed") => void;
  onReallocate: (bookingId: string, poId: string) => void;
}) {
  const balance = poBalance(po, state.allocations);
  const rows = ledger(po, state.allocations.map((a) => ({ ...a, amount_inr: Number(a.amount_inr) })));
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / Math.max(balance.amount, 1)) * 100))}%`;
  const closed = po.status === "closed";

  return (
    <section className={cn("panel overflow-hidden", closed && "opacity-70")} aria-label={`Purchase order ${po.po_number}`}>
      <header className="border-line flex flex-wrap items-start gap-x-4 gap-y-1 border-b px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-fg flex items-center gap-2 font-mono text-[13.5px] font-medium">
            {po.po_number}
            <span className="pill font-sans text-[11px]">{closed ? "closed" : "open"}</span>
            {balance.overrun && <span className="pill border-rose/25 bg-rose/[0.06] text-rose font-sans text-[11px]">overrun</span>}
          </p>
          <p className="text-fg-subtle mt-0.5 text-[12.5px]">
            {po.description ? `${po.description} · ` : ""}
            {scope} · {fmtDay(po.valid_from)} – {fmtDay(po.valid_to)}
          </p>
        </div>
        {canManage && (
          <button type="button" onClick={() => onStatus(closed ? "open" : "closed")} className="btn btn-ghost h-7 px-2.5 text-[12px]">
            {closed ? "Reopen" : "Close"}
          </button>
        )}
      </header>

      <div className="px-5 py-3.5">
        {/* Flat meter: consumed, then committed; the remainder is the balance. */}
        <div className="bg-surface-raised border-line relative h-2 overflow-hidden rounded-sm border" role="img" aria-label={`${balance.usedPct}% drawn`}>
          <span className="bg-fg absolute inset-y-0 left-0" style={{ width: pct(balance.consumed) }} />
          <span className="bg-fg-subtle absolute inset-y-0" style={{ left: pct(balance.consumed), width: pct(balance.committed) }} />
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px] tabular-nums sm:grid-cols-4">
          {(
            [
              ["value", formatINR(balance.amount)],
              ["consumed", formatINR(balance.consumed)],
              ["committed", formatINR(balance.committed)],
              ["remaining", formatINR(balance.remaining)],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="label-mono">{k}</dt>
              <dd className={cn("text-fg", k === "remaining" && balance.overrun && "text-rose")}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {rows.length > 0 && (
        <div className="border-line overflow-x-auto border-t">
          <table className="w-full min-w-[34rem] text-[12.5px]">
            <thead>
              <tr className="border-line border-b">
                {["Booking", "Status", "Amount", "Balance after", ""].map((h, i) => (
                  <th key={i} scope="col" className={cn("label-mono h-8 px-3 font-medium first:pl-5 last:pr-5", i >= 2 && i <= 3 ? "text-right" : "text-left")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const b = bookings.find((x) => x.id === subjectOf(a));
                return (
                  <tr key={a.id} className={cn("border-line border-b last:border-b-0", a.status === "released" && "text-fg-faint")}>
                    <td className="text-fg max-w-64 truncate py-2 pr-3 pl-5">{b?.label ?? subjectOf(a).slice(0, 8)}</td>
                    <td className="text-fg-subtle px-3 font-mono text-[11.5px]">
                      {a.status}
                      {a.over_balance && <span className="text-rose"> · signed-off overrun</span>}
                    </td>
                    <td className={cn("px-3 text-right font-mono tabular-nums", a.status === "released" && "line-through")}>{formatINR(a.amount_inr)}</td>
                    <td className={cn("px-3 text-right font-mono tabular-nums", a.balanceAfter < 0 && "text-rose")}>{formatINR(a.balanceAfter)}</td>
                    <td className="py-1.5 pr-5 pl-3 text-right">
                      {canManage && b?.kind === "booking" && a.status === "committed" && (
                        <PoSelect booking={b} state={state} exclude={po.id} onPick={(poId) => onReallocate(b.id, poId)} placeholder="Move to…" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** POs a booking could move to: open, in window, right department, with room for it. */
function PoSelect({ booking, state, exclude, onPick, placeholder }: { booking: LedgerBooking; state: State; exclude?: string; onPick: (poId: string) => void; placeholder: string }) {
  const amount = Number(state.allocations.find((a) => a.booking_id === booking.id)?.amount_inr ?? 0);
  const options = state.pos.filter(
    (p) =>
      p.id !== exclude &&
      ineligibility(p, { tenantId: p.tenant_id, eventDate: booking.eventDate, departmentId: booking.departmentId }) === null &&
      poBalance(p, state.allocations, booking.id).remaining >= amount
  );
  if (options.length === 0) return null;
  return (
    <label>
      <span className="sr-only">
        {placeholder} {booking.label}
      </span>
      <select
        value=""
        onChange={(e) => e.target.value && onPick(e.target.value)}
        className="border-line bg-surface text-fg-muted h-7 rounded-md border px-2 font-mono text-[11.5px]"
      >
        <option value="">{placeholder}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.po_number} · {formatINR(poBalance(p, state.allocations, booking.id).remaining)} left
          </option>
        ))}
      </select>
    </label>
  );
}

function NewPoForm({
  companyId,
  departments,
  existing,
  mutate,
}: {
  companyId: string;
  departments: { id: string; name: string }[];
  existing: string[];
  mutate: ReturnType<typeof useOptimisticMutation<State>>["mutate"];
}) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const input: NewPoInput = {
      po_number: String(f.get("po_number") ?? ""),
      amount_inr: Number(f.get("amount")),
      valid_from: String(f.get("valid_from") ?? ""),
      valid_to: String(f.get("valid_to") ?? ""),
      department_id: String(f.get("department_id") ?? "") || null,
      description: String(f.get("description") ?? ""),
    };
    // Same rules as the server, so a typo shows here instead of as a rollback.
    const valid = validateNewPo(input, existing);
    if (!valid.ok) {
      setError(valid.error);
      return;
    }
    setError(null);
    const tempId = `pending-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    setSaving(true);
    const outcome = await mutate({
      apply: (s) => ({
        ...s,
        pos: [
          ...s.pos,
          { id: tempId, tenant_id: companyId, ...valid.value, description: valid.value.description ?? null, department_id: valid.value.department_id ?? null, currency: "INR", status: "open", created_by: null, created_at: now, updated_at: now },
        ],
      }),
      action: () => createPurchaseOrderAction(companyId, valid.value),
      commit: (s, po) => ({ ...s, pos: [...s.pos.filter((p) => p.id !== tempId), po] }),
      failure: `Couldn't raise ${valid.value.po_number}`,
      success: (po) => ({ tone: "success", title: `Raised ${po.po_number}`, description: formatINR(Number(po.amount_inr)) }),
    });
    setSaving(false);
    if (outcome.ok) {
      form.reset();
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn h-8 px-3 text-[12.5px]">
        <Plus className="size-3.5" aria-hidden /> Raise a purchase order
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="panel grid gap-3 px-5 py-4 text-[12.5px] sm:grid-cols-2">
      <h3 className="label-mono sm:col-span-2">Raise a purchase order</h3>
      <label className="grid gap-1">
        <span className="text-fg-subtle">PO number</span>
        <input name="po_number" required maxLength={40} placeholder="NIM-FY27-Q4" className="field h-8 font-mono uppercase" />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-subtle">Value (₹, pre-GST)</span>
        <input name="amount" type="number" min={1} step={1} required className="field h-8 font-mono" />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-subtle">Valid from</span>
        <input name="valid_from" type="date" required className="field h-8 font-mono" />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-subtle">Valid to</span>
        <input name="valid_to" type="date" required className="field h-8 font-mono" />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-subtle">Scope</span>
        <select name="department_id" className="field h-8">
          <option value="">Company-wide</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-fg-subtle">Description</span>
        <input name="description" maxLength={200} placeholder="Optional" className="field h-8" />
      </label>
      {error && (
        <p role="alert" className="text-rose text-[12px] sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost h-8 px-3">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn btn-primary h-8 px-3">
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Raise PO
        </button>
      </div>
    </form>
  );
}
