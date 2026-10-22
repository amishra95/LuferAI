"use client";

import { useState, useTransition } from "react";
import { FileText, Loader2, Send, Undo2 } from "lucide-react";

import { exportBookingToERP, setItcDecision } from "@/app/(dashboard)/client/actions";
import { Pill, type PillTone } from "@/components/portal/pills";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { EXPENSE_PROVIDERS, PROVIDER_LABEL, type ExpenseProvider } from "@/lib/finance/expense-adapters";
import { ITC_LABEL, type ItcStatus } from "@/lib/finance/itc";
import type { SettlementTone } from "@/lib/finance/settlement";
import type { SettlementView } from "@/lib/finance/settlement-store";
import { cn, formatDate, formatINR } from "@/lib/utils";

const ITC_TONE: Record<ItcStatus, PillTone> = {
  eligible: "ok",
  blocked: "error",
  review: "warn",
  awaiting_invoice: "neutral",
  not_eligible: "error",
  not_applicable: "neutral",
};

const EXPORT_TONE: Record<string, PillTone> = { delivered: "ok", mocked: "warn", failed: "error" };
const EXPORT_LABEL: Record<string, string> = { delivered: "Delivered", mocked: "Recorded (no endpoint)", failed: "Failed" };
const DOT: Record<SettlementTone, string> = { ok: "bg-sage", warn: "bg-warn", error: "bg-rose", neutral: "bg-fg-faint" };

const time = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/**
 * A booking's settlement for finance: its PO line, the GST breakdown as
 * invoiced, input tax credit status (with the review decision for Approvers),
 * exports to expense/ERP systems with a one-click send, and the trail.
 */
export function SettlementCard({ view, canAct }: { view: SettlementView; canAct: boolean }) {
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState<ExpenseProvider>(view.defaultProvider);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { gst, itc } = view;
  const intra = gst.gstType !== "IGST";

  const run = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, done: string) =>
    startTransition(async () => {
      setMessage(null);
      const r = await fn();
      if (!r.ok) setMessage({ ok: false, text: r.error });
      else {
        const data = r.data as { error?: string; message?: string };
        setMessage(data.error ? { ok: false, text: data.error } : { ok: true, text: data.message ?? done });
      }
    });

  return (
    <article className="panel grid gap-5 p-5" aria-labelledby={`settlement-${view.bookingId}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`settlement-${view.bookingId}`} className="text-fg text-body font-medium">
            {view.venueName}
          </h3>
          <p className="text-fg-subtle text-caption">
            {formatDate(view.eventDate)} · {view.status.toLowerCase()}
          </p>
        </div>
        {view.po ? (
          <span className="border-line text-fg inline-flex items-center gap-1.5 rounded-badge border px-2.5 py-0.5 font-mono text-caption" title={`PO line: ${formatINR(view.po.amountInr)} ${view.po.allocationStatus}${view.po.overBalance ? ", over balance with sign-off" : ""}`}>
            <FileText className="size-3.5" aria-hidden /> {view.po.lineRef}
          </span>
        ) : (
          <span className="text-fg-faint text-caption">No purchase order</span>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="GST breakdown">
          <h4 className="label-mono mb-2">Tax invoice · SAC {gst.sacCode}</h4>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-body">
            <dt className="text-fg-subtle">Supplier GSTIN</dt>
            <dd className="text-right font-mono text-caption">{gst.supplierGstin}</dd>
            <dt className="text-fg-subtle">Billed GSTIN</dt>
            <dd className="text-right font-mono text-caption">{gst.recipientGstin}</dd>
            <dt className="text-fg-subtle">Place of supply</dt>
            <dd className="text-right">
              {gst.placeOfSupply} · {intra ? "intra-state" : "inter-state"}
            </dd>
            <dt className="text-fg-subtle">Taxable value</dt>
            <dd className="figure text-right">{formatINR(gst.taxableValue, true)}</dd>
            {intra ? (
              <>
                <dt className="text-fg-subtle">CGST</dt>
                <dd className="figure text-right">{formatINR(gst.cgst, true)}</dd>
                <dt className="text-fg-subtle">SGST</dt>
                <dd className="figure text-right">{formatINR(gst.sgst, true)}</dd>
              </>
            ) : (
              <>
                <dt className="text-fg-subtle">IGST</dt>
                <dd className="figure text-right">{formatINR(gst.igst, true)}</dd>
              </>
            )}
            <div className="border-line col-span-2 mt-1 grid grid-cols-subgrid border-t pt-2">
              <dt className="font-medium">Invoice total</dt>
              <dd className="figure text-right font-medium">{formatINR(gst.invoiceTotal, true)}</dd>
            </div>
          </dl>
        </section>

        <div className="grid content-start gap-5">
          <section aria-label="Input tax credit">
            <h4 className="label-mono mb-2">Input tax credit</h4>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={ITC_TONE[itc.status]}>{ITC_LABEL[itc.status]}</Pill>
              <span className="figure text-fg-muted text-caption">{formatINR(gst.totalTax, true)} GST</span>
            </div>
            {itc.note ? <p className="text-fg-subtle mt-1 text-caption">{itc.note}</p> : null}
            <p className="text-fg-faint mt-1.5 font-mono text-[0.6875rem] leading-4 break-words">{itc.tags.join(" · ")}</p>
            {canAct && itc.status === "review" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setItcDecision(view.bookingId, "eligible"), "Marked ITC eligible.")}>
                  Eligible
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => setItcDecision(view.bookingId, "blocked", "Blocked under Sec. 17(5)"), "Marked ITC blocked.")}
                >
                  Blocked (Sec. 17(5))
                </Button>
              </div>
            ) : canAct && (itc.status === "eligible" || itc.status === "blocked") ? (
              <Button size="sm" variant="ghost" className="mt-1" disabled={pending} onClick={() => run(() => setItcDecision(view.bookingId, null), "Sent back to review.")}>
                <Undo2 aria-hidden /> Back to review
              </Button>
            ) : null}
          </section>

          <section aria-label="Expense and ERP exports">
            <h4 className="label-mono mb-2">Expense &amp; ERP</h4>
            {view.exports.length ? (
              <ul className="grid gap-1 text-body">
                {view.exports.map((e) => (
                  <li key={e.provider} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-28">{PROVIDER_LABEL[e.provider]}</span>
                    <Pill tone={EXPORT_TONE[e.status] ?? "neutral"} title={e.error ?? undefined}>
                      {EXPORT_LABEL[e.status] ?? e.status}
                    </Pill>
                    {e.attempts > 1 ? <span className="text-fg-faint text-caption">{e.attempts} attempts</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-fg-subtle text-caption">Not sent to a finance system yet.</p>
            )}
            {canAct ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor={`provider-${view.bookingId}`} className="sr-only">
                  Expense system
                </label>
                <NativeSelect id={`provider-${view.bookingId}`} value={provider} onChange={(e) => setProvider(e.target.value as ExpenseProvider)} className="w-44">
                  {EXPENSE_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABEL[p]}
                      {p === view.defaultProvider ? " (default)" : ""}
                    </option>
                  ))}
                </NativeSelect>
                <Button size="sm" disabled={pending} onClick={() => run(() => exportBookingToERP(view.bookingId, provider), `Sent to ${PROVIDER_LABEL[provider]}.`)}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Export
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {message ? (
        <p role="status" className={cn("text-body", message.ok ? "text-sage" : "text-rose")}>
          {message.text}
        </p>
      ) : null}

      <details className="group">
        <summary className="text-fg-subtle hover:text-fg cursor-pointer text-caption">Settlement trail ({view.timeline.length})</summary>
        <ol className="border-line mt-3 ml-1 grid gap-2 border-l pl-4">
          {view.timeline.map((ev, i) => (
            <li key={`${ev.at}-${i}`} className="relative text-body">
              <span aria-hidden className={cn("status-dot absolute top-1.5 -left-[1.3rem]", DOT[ev.tone])} />
              <span className="text-fg">{ev.label}</span>
              {ev.detail ? <span className="text-fg-subtle"> · {ev.detail}</span> : null}
              <time dateTime={ev.at} className="text-fg-faint block font-mono text-caption">
                {time.format(new Date(ev.at))}
              </time>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}
