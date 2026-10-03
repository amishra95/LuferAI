"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GST_RATE_PERCENT, gstOn } from "@/lib/gst-engine";
import { formatINR } from "@/lib/utils";

/**
 * 18% GST ITC savings calculator.
 * Shows what has been reclaimed on invoiced (completed) bookings, plus a what-if
 * for planned spend.
 */
export function ItcCalculator({
  reclaimed,
  pipeline,
  committedSpend,
}: {
  reclaimed: number;
  pipeline: number;
  committedSpend: number;
}) {
  const [planned, setPlanned] = useState("250000");
  const plannedValue = Number(planned) || 0;
  const plannedItc = gstOn(plannedValue);

  return (
    <div className="grid gap-5">
      <div>
        <p className="text-muted-foreground text-sm">Total tax credits reclaimed</p>
        <p className="text-primary text-3xl font-semibold tabular-nums">{formatINR(reclaimed, true)}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {formatINR(pipeline)} more becomes claimable once upcoming events are invoiced.
        </p>
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

      <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">GST @ {GST_RATE_PERCENT}%</dt>
        <dd className="text-right tabular-nums">{formatINR(plannedItc, true)}</dd>
        <dt className="text-muted-foreground">Gross outlay</dt>
        <dd className="text-right tabular-nums">{formatINR(plannedValue + plannedItc, true)}</dd>
        <dt className="font-medium">Net cost after ITC</dt>
        <dd className="text-right font-medium tabular-nums">{formatINR(plannedValue, true)}</dd>
        <dt className="text-muted-foreground">Committed spend to date</dt>
        <dd className="text-right tabular-nums">{formatINR(committedSpend)}</dd>
      </dl>

      <p className="text-muted-foreground text-xs leading-relaxed">
        ITC is available only on valid tax invoices issued to your GSTIN and subject to Sections 16–17 of
        the CGST Act — credit on food & beverage supplies can be restricted. Confirm eligibility with your tax team.
      </p>
    </div>
  );
}
