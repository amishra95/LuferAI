import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { CopyButton } from "@/components/portal/copy-button";
import { HoldCountdown } from "@/components/portal/hold-countdown";
import { MarkdownMatrix } from "@/components/portal/markdown-matrix";
import { InPolicyPill, OutOfPolicyPill, PendingApprovalPill, RateCardPill, RejectedPill } from "@/components/portal/pills";
import { PortalShell } from "@/components/portal/portal-shell";
import { BookingStatusBadge, GstTypeBadge, PaymentStatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { activeHolds, approvalQueue, type ActiveHold } from "@/lib/approvals/service";
import { requirePortal } from "@/lib/auth/session";
import { getVenueCatalog } from "@/lib/catalog";
import { computeItcSummary, dataSource, listApprovals, listBookings, listCompanies, type BookingDetail } from "@/lib/data";
import { partyStateCode, roundInr, stateName } from "@/lib/gst-engine";
import { latestPayments, paymentsEnabled } from "@/lib/payments/service";
import { DEPOSIT_RATE, depositFor } from "@/lib/quotes";
import { listRfps } from "@/lib/rfp/service";
import type { ApprovalStatus, Payment } from "@/lib/supabase/database.types";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { ItcCalculator } from "./_components/itc-calculator";
import { PayDepositButton } from "./_components/pay-deposit-button";
import { RfpBroadcastForm } from "./_components/rfp-broadcast-form";
import { VenueExplorer } from "./_components/venue-explorer";

export default async function ClientPage({ searchParams }: PageProps<"/client">) {
  const member = await requirePortal("/client");
  const { company: companyParam, deposit } = await searchParams;
  const allCompanies = await listCompanies();
  // Clients are pinned to their own company; admins may switch via ?company=<id>.
  const companies = member.role === "ADMIN" ? allCompanies : allCompanies.filter((c) => c.id === member.companyId);
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  const live = dataSource() === "supabase";
  const [bookings, catalog] = await Promise.all([listBookings({ companyId: company.id }), getVenueCatalog(company.id)]);
  const [payments, holds, rfps, approvals, queue] = await Promise.all([
    latestPayments(bookings.map((b) => b.id)),
    activeHolds(bookings.map((b) => b.id)),
    live ? listRfps({ companyId: company.id }) : Promise.resolve([]),
    listApprovals({ tenantId: company.id }),
    approvalQueue(member, company.id),
  ]);
  // Latest approval decision per booking (listApprovals is newest first).
  const approvalByBooking = new Map<string, { status: ApprovalStatus; reason: string | null }>();
  for (const a of approvals) if (!approvalByBooking.has(a.booking_id)) approvalByBooking.set(a.booking_id, a);
  const itc = computeItcSummary(bookings);
  const canPay = paymentsEnabled();
  const awaitingApproval = queue.length;

  return (
    <PortalShell
      portal="/client"
      title={company.legal_name}
      subtitle={`GSTIN ${company.gstin} · ${stateName(partyStateCode(company))} · monthly cap ${formatINR(Number(company.monthly_spend_limit_inr))}`}
      actions={
        awaitingApproval > 0 ? (
          <Button asChild variant="outline">
            <Link href="/client/approvals">
              <ClipboardCheck aria-hidden /> {awaitingApproval} awaiting approval
            </Link>
          </Button>
        ) : null
      }
    >
      {companies.length > 1 ? (
        <div className="-mt-3 mb-6 flex gap-2 overflow-x-auto pb-1 text-sm [scrollbar-width:none]" aria-label="Switch company (admin)">
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/client?company=${c.id}`}
              aria-current={c.id === company.id ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 pointer-coarse:min-h-11",
                c.id === company.id ? "border-zinc-500 bg-zinc-800 text-zinc-50" : "border-zinc-800/60 text-zinc-400 hover:text-zinc-100"
              )}
            >
              {c.legal_name.replace(" Private Limited", "")}
            </Link>
          ))}
        </div>
      ) : null}

      {deposit === "success" || deposit === "cancelled" ? (
        <p role="status" className="glass mb-6 rounded-xl px-4 py-3 text-sm text-zinc-200">
          {deposit === "success"
            ? "Deposit authorised — it's captured only when the venue confirms. Status updates here in a moment."
            : "Checkout cancelled. Nothing was charged."}
        </p>
      ) : null}

      {live ? (
        <section aria-label="Plan an event" className="mb-10">
          <RfpBroadcastForm />
        </section>
      ) : null}

      <VenueExplorer venues={catalog.venues} company={{ id: company.id, gstin: company.gstin }} departments={catalog.departments} />

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Your bookings</CardTitle>
            <CardDescription>
              {bookings.length} total · in-policy requests go straight to the venue and hold the date while it responds
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bookings.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-400">No bookings yet — pick a venue above to send your first request.</p>
            ) : (
              <ul className="divide-y divide-zinc-800/60">
                {bookings.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    approval={approvalByBooking.get(b.id)}
                    hold={holds.get(b.id)}
                    payment={payments.get(b.id)}
                    canPay={canPay}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>GST ITC savings</CardTitle>
            <CardDescription>18% GST on SAC 998596 is claimable as input tax credit.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItcCalculator reclaimed={itc.reclaimed} pipeline={itc.pipeline} committedSpend={itc.committedSpend} />
          </CardContent>
        </Card>
      </div>

      {rfps.length > 0 ? (
        <section className="mt-10 grid gap-4" aria-labelledby="rfp-heading">
          <div>
            <h2 id="rfp-heading" className="text-lg font-semibold text-zinc-50">
              RFP comparisons
            </h2>
            <p className="text-sm text-zinc-400">Instant quotes from your packages and rate card; venues can counter-offer.</p>
          </div>
          {rfps.map(({ rfp, markdown }) => (
            <Card key={rfp.id} className="gap-3">
              <CardHeader className="flex flex-row flex-wrap items-center gap-2">
                <CardTitle className="text-base">{formatDate(rfp.created_at.slice(0, 10))}</CardTitle>
                <CardDescription className="line-clamp-1 flex-1">{rfp.brief}</CardDescription>
                <CopyButton text={markdown} label="Copy Markdown" />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <MarkdownMatrix markdown={markdown} />
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
    </PortalShell>
  );
}

function PolicyPill({ approval }: { approval: { status: ApprovalStatus; reason: string | null } | undefined }) {
  if (!approval) return <InPolicyPill />;
  switch (approval.status) {
    case "PENDING":
      return <PendingApprovalPill />;
    case "REJECTED":
      return <RejectedPill />;
    default:
      return <OutOfPolicyPill reasons={`Approved exception: ${approval.reason ?? "outside policy"}`} />;
  }
}

function BookingRow({
  booking: b,
  approval,
  hold,
  payment,
  canPay,
}: {
  booking: BookingDetail;
  approval: { status: ApprovalStatus; reason: string | null } | undefined;
  hold: ActiveHold | undefined;
  payment: Payment | undefined;
  canPay: boolean;
}) {
  const deposit = depositFor(b.invoice.invoice_total);
  const liveDeposit = payment && (payment.status === "authorized" || payment.status === "captured");
  const listPerHead = b.list_budget_per_head_inr != null ? Number(b.list_budget_per_head_inr) : null;
  const savings = listPerHead != null ? roundInr(Math.max(0, b.party_size * listPerHead - b.total_amount_inr)) : 0;

  return (
    <li className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-zinc-50">{b.venue.name}</span>
          <span className="text-sm text-zinc-400">
            {formatDate(b.event_date)} · {b.party_size} guests
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <BookingStatusBadge status={b.status} />
          {b.status !== "CANCELLED" || approval?.status === "REJECTED" ? <PolicyPill approval={approval} /> : null}
          {savings > 0 ? <RateCardPill label={`−${formatINR(savings)}`} /> : null}
          <GstTypeBadge type={b.invoice.gst_type} />
          {payment ? <PaymentStatusBadge status={payment.status} /> : null}
        </div>
        {hold && (b.status === "PENDING" || b.status === "PENDING_APPROVAL") ? (
          <HoldCountdown createdAt={hold.holdStart} expiresAt={hold.expiresAt} className="mt-3 max-w-64" />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 md:justify-end">
        <dl className="text-right text-sm">
          <dt className="sr-only">Invoice total</dt>
          <dd className="font-medium text-zinc-50 tabular-nums">{formatINR(b.invoice.invoice_total)}</dd>
          <dd className="text-xs text-zinc-500 tabular-nums">
            {formatINR(b.total_amount_inr)} + {formatINR(b.invoice.total_tax)} GST
          </dd>
        </dl>
        {/* PENDING = signed off (or in policy) and with the venue; deposits are taken then. */}
        {canPay && b.status === "PENDING" && !liveDeposit ? (
          <PayDepositButton bookingId={b.id} label={`Pay ${formatINR(deposit)} deposit (${Math.round(DEPOSIT_RATE * 100)}%)`} />
        ) : null}
      </div>
    </li>
  );
}
