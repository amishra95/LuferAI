import { PayDepositButton } from "@/app/(dashboard)/client/_components/pay-deposit-button";
import { Pill } from "@/components/portal/pills";
import { AcceptQuote } from "./accept-quote";
import { WithdrawRequest } from "./withdraw-request";
import { quoteLine, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, requestSummary, statusOf } from "@/lib/concierge/requests";
import type { ConciergeRequest } from "@/lib/supabase/database.types";

const sentOn = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * A company's quote requests and briefs on Home, with where each stands and
 * Lufer's latest note. A quoted request shows its total with Accept; an
 * accepted one shows Pay until it's paid, then its receipt.
 * `withdrawable` / `acceptable` / `payable`: ids this member may act on;
 * `paid`: ids already paid.
 */
export function RequestList({
  requests,
  withdrawable = [],
  acceptable = [],
  payable = [],
  paid = [],
}: {
  requests: ConciergeRequest[];
  withdrawable?: readonly string[];
  acceptable?: readonly string[];
  payable?: readonly string[];
  paid?: readonly string[];
}) {
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="requests-heading" className="mb-10">
      <h2 id="requests-heading" className="text-fg mb-3 text-body font-semibold tracking-tight">
        Requests
      </h2>
      <ul className="panel divide-line divide-y">
        {requests.map((r) => {
          const status = statusOf(r.status);
          const total = r.quote_total_inr == null ? null : Number(r.quote_total_inr);
          const quote = total != null && (status === "quoted" || status === "booked") ? quoteLine({ quote_total_inr: total, guests: r.guests }) : null;
          const isPaid = paid.includes(r.id);
          return (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3">
              <div className="min-w-0">
                <p className="text-fg truncate text-meta font-medium">{requestSummary(r)}</p>
                {quote ? (
                  <p className="text-fg text-meta">
                    {quote}, taxes included
                    {r.quote_note ? <span className="text-fg-subtle"> · {r.quote_note}</span> : null}
                  </p>
                ) : null}
                <p className="text-fg-subtle text-caption">
                  {sentOn(r.created_at)}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </div>
              <span className="flex flex-wrap items-center justify-end gap-2">
                {withdrawable.includes(r.id) ? <WithdrawRequest requestId={r.id} /> : null}
                {total != null && acceptable.includes(r.id) ? <AcceptQuote requestId={r.id} totalInr={total} /> : null}
                {total != null && !isPaid && payable.includes(r.id) ? <PayDepositButton requestId={r.id} label={`Pay ${inr(total)}`} /> : null}
                {isPaid ? (
                  <a href={`/api/requests/${r.id}/receipt`} target="_blank" rel="noopener" className="text-fg text-caption hover:underline">
                    Receipt
                  </a>
                ) : null}
                {isPaid ? <Pill tone="ok">Paid</Pill> : <Pill tone={REQUEST_STATUS_TONE[status]}>{REQUEST_STATUS_LABEL[status]}</Pill>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
