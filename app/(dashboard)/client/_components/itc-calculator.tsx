"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GST_RATE_PERCENT, gstOn } from "@/lib/gst-engine";
import { formatINR } from "@/lib/utils";

/**
 * 18% GST ITC calculator. Shows the credit finance has confirmed as claimable,
 * what's pending their review or the tax invoice, and what's blocked
 * (lib/finance/itc.ts), plus a what-if for planned spend.
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
  const [planned, setPlanned] = useState("250000");
  const plannedValue = Number(planned) || 0;
  const plannedItc = gstOn(plannedValue);

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

      <div className="grid gap-2">
        <Label htmlFor="planned_spend">Plan ahead: taxable spend (₹)</Label>
        <Input
          id="planned_spend"
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={planned}
          onChange={(e) => setPlanned(e.target.value)}
        />
      </div>

      <dl className="grid grid-cols-2 gap-y-1.5 text-body">
        <dt className="text-muted-foreground">GST @ {GST_RATE_PERCENT}%</dt>
        <dd className="text-right tabular-nums">{formatINR(plannedItc, true)}</dd>
        <dt className="text-muted-foreground">Gross outlay</dt>
        <dd className="text-right tabular-nums">{formatINR(plannedValue + plannedItc, true)}</dd>
        <dt className="font-medium">Net cost after ITC</dt>
        <dd className="text-right font-medium tabular-nums">{formatINR(plannedValue, true)}</dd>
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
