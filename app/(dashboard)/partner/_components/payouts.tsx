import Link from "next/link";
import { Banknote, Landmark, Receipt } from "lucide-react";

import { StatCard } from "@/components/portal/stat-card";
import { EmptyState } from "@/components/portal/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sumInr } from "@/lib/gst-engine";
import type { Partner, TcsEntry, VendorPayout } from "@/lib/supabase/database.types";
import { cn, formatINR } from "@/lib/utils";
import { PayoutTermsForm } from "./payout-terms-form";

const STATUS_LABEL: Record<string, string> = {
  pending: "Starting",
  on_hold: "On hold until delivery",
  released: "Released",
  settled: "In your bank",
  reversed: "Reversed (refunded)",
  failed: "Failed",
};

export interface PayoutRow {
  orderId: string;
  label: string;
  company: string;
  payout: VendorPayout;
  issues: string[];
}

/**
 * The partner's money: where payouts go (Razorpay Route linked account), each
 * order's split (invoice total − commission − GST on it − TCS = payout), and
 * the Section 52 TCS collected on their supplies by GSTR-8 period, which they
 * claim as credit once it shows in their GSTR-2X.
 */
export function PartnerPayouts({
  partner,
  isAdmin,
  enabled,
  rows,
  tcs,
  ordersHref,
}: {
  partner: Partner;
  isAdmin: boolean;
  enabled: boolean;
  rows: PayoutRow[];
  tcs: TcsEntry[];
  /** The Orders tab, for the empty state's next step. */
  ordersHref?: string;
}) {
  const held = sumInr(rows.filter((r) => r.payout.status === "on_hold" || r.payout.status === "pending").map((r) => Number(r.payout.net_payout_inr)));
  const paid = sumInr(rows.filter((r) => r.payout.status === "released" || r.payout.status === "settled").map((r) => Number(r.payout.net_payout_inr)));
  const tcsTotal = sumInr(tcs.map((t) => Number(t.cgst_inr) + Number(t.sgst_inr) + Number(t.igst_inr)));

  const periods = [...new Set(tcs.map((t) => t.return_period))];
  const byPeriod = periods.map((p) => {
    const e = tcs.filter((t) => t.return_period === p);
    const sum = (k: "taxable_inr" | "cgst_inr" | "sgst_inr" | "igst_inr") => sumInr(e.map((t) => Number(t[k])));
    return { period: p, taxable: sum("taxable_inr"), cgst: sum("cgst_inr"), sgst: sum("sgst_inr"), igst: sum("igst_inr") };
  });

  return (
    <div className="space-y-6">
      {!enabled ? (
        <p role="status" className="border-line text-fg-muted rounded-md border px-4 py-3 text-meta">
          Online payment and payouts are off in this environment: they need Supabase, Razorpay keys with Route enabled, and PLATFORM_GSTIN.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payout account</CardTitle>
          <CardDescription>
            Buyers pay Lufer.ai; your share is transferred to your Razorpay Route linked account when you confirm, held until you mark the order delivered, then settled to your bank on
            Razorpay&apos;s schedule. Commission: {Math.round(Number(partner.commission_rate) * 10_000) / 100}% of the pre-GST value, plus 18% GST on it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <PayoutTermsForm partnerId={partner.id} accountId={partner.razorpay_account_id} commissionRate={Number(partner.commission_rate)} />
          ) : partner.razorpay_account_id ? (
            <p className="font-mono text-meta">
              Connected: {partner.razorpay_account_id.slice(0, 8)}…{partner.razorpay_account_id.slice(-4)}
            </p>
          ) : (
            <p className="text-warn text-meta">Not connected yet. Paid orders wait until your Lufer.ai contact connects your Razorpay linked account.</p>
          )}
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Payout summary">
        <StatCard label="On hold" value={formatINR(held, true)} hint="Released when you mark orders delivered" icon={Banknote} />
        <StatCard label="Released" value={formatINR(paid, true)} hint="Settling or in your bank" icon={Landmark} />
        <StatCard label="TCS credited" value={formatINR(tcsTotal, true)} hint="Section 52, net of returns" icon={Receipt} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Payouts</CardTitle>
          <CardDescription>What the buyer paid, less commission, GST on commission and TCS.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              compact
              icon={Banknote}
              title="No payouts yet"
              description="A payout starts when you confirm an order the buyer has paid for, and is released when you mark it delivered."
              action={
                ordersHref ? (
                  <Link href={ordersHref} className="btn btn-primary h-8 px-3 text-meta">
                    Go to Orders
                  </Link>
                ) : null
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead className="text-right">Paid by buyer</TableHead>
                  <TableHead className="text-right">Commission + GST</TableHead>
                  <TableHead className="text-right">TCS</TableHead>
                  <TableHead className="text-right">You receive</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.orderId}>
                    <TableCell>
                      <div className="font-medium">{r.label}</div>
                      <div className="text-fg-subtle text-caption">{r.company}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatINR(Number(r.payout.gross_inr), true)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(Number(r.payout.commission_inr) + Number(r.payout.commission_gst_inr), true)}
                      <div className="text-fg-faint text-caption">{Math.round(Number(r.payout.commission_rate) * 10_000) / 100}% + GST</div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(Number(r.payout.tcs_inr), true)}
                      <div className="text-fg-faint text-caption">{r.payout.tcs_rate_bps / 100}%</div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">{formatINR(Number(r.payout.net_payout_inr), true)}</TableCell>
                    <TableCell>
                      <span className={cn("text-meta", r.payout.status === "failed" && "text-rose", r.payout.status === "settled" && "text-sage")}>{STATUS_LABEL[r.payout.status] ?? r.payout.status}</span>
                      {r.payout.last_error || r.issues.length ? <div className="text-warn mt-0.5 max-w-60 text-caption">{r.payout.last_error ?? r.issues[0]}</div> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>TCS collected (Section 52)</CardTitle>
          <CardDescription>
            Reported by Lufer.ai in GSTR-8 for each month; it appears in your GSTR-2X for you to accept and claim as credit. Returns are deducted in the month they happen.
            {isAdmin ? (
              <>
                {" "}
                <a href="/api/admin/tcs" download className="text-fg underline underline-offset-2">
                  Download this month&apos;s GSTR-8 rows (all partners)
                </a>
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {byPeriod.length === 0 ? (
            <EmptyState compact icon={Receipt} title="No TCS collected yet" description="TCS is collected on each paid order and listed here by return period." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Net taxable supplies</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byPeriod.map((p) => (
                  <TableRow key={p.period}>
                    <TableCell className="font-mono">{p.period}</TableCell>
                    {[p.taxable, p.cgst, p.sgst, p.igst].map((n, i) => (
                      <TableCell key={i} className="text-right font-mono tabular-nums">
                        {formatINR(n, true)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
