import { formatINR } from "@/lib/utils";

/**
 * GST input tax credit summary. Shows the credit finance has confirmed as claimable,
 * what's pending their review or the tax invoice, and what's blocked
 * (lib/finance/itc.ts). No what-if: F&B credit is often blocked (CGST 17(5)(b)),
 * so a planner assuming full credit would overstate the saving.
 */
export function ItcCalculator({
  eligible,
  pendingReview,
  awaitingInvoice,
  blocked,
  committedSpend,
}: {
  eligible: number;
  pendingReview: number;
  awaitingInvoice: number;
  blocked: number;
  committedSpend: number;
}) {

  return (
    <div className="grid gap-5">
      <div>
        <p className="text-muted-foreground text-body">Tax credit confirmed claimable</p>
        <p className="text-fg font-mono text-hero leading-tight font-medium tracking-[-0.03em] tabular-nums">{formatINR(eligible, true)}</p>
        <dl className="text-muted-foreground mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-caption">
          <dt>Pending finance review</dt>
          <dd className="text-right tabular-nums">{formatINR(pendingReview)}</dd>
          <dt>Awaiting tax invoice</dt>
          <dd className="text-right tabular-nums">{formatINR(awaitingInvoice)}</dd>
          <dt>Blocked / not eligible</dt>
          <dd className="text-right tabular-nums">{formatINR(blocked)}</dd>
        </dl>
      </div>

      <dl className="grid grid-cols-2 gap-y-1.5 text-body">
        <dt className="text-muted-foreground">Committed spend to date</dt>
        <dd className="text-right tabular-nums">{formatINR(committedSpend)}</dd>
      </dl>

      <p className="text-muted-foreground text-caption leading-relaxed">
        ITC is available only on valid tax invoices issued to your GSTIN and subject to Sections 16–17 of
        the CGST Act — credit on food & beverage supplies can be restricted. Confirm eligibility with your tax team.
      </p>
    </div>
  );
}
