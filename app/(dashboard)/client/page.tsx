import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck, Download, Eye } from "lucide-react";

import { CopyButton } from "@/components/portal/copy-button";
import { HoldCountdown } from "@/components/portal/hold-countdown";
import { MarkdownMatrix } from "@/components/portal/markdown-matrix";
import { RateCardPill } from "@/components/portal/pills";
import { PortalShell } from "@/components/portal/portal-shell";
import { segmentClass } from "@/components/portal/segment";
import { BookingStatusBadge, GstTypeBadge, PaymentStatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { activeHolds, approvalQueue } from "@/lib/approvals/service";
import { requirePortal } from "@/lib/auth/session";
import { statusCounts } from "@/lib/bookings/live";
import { getVenueCatalog } from "@/lib/catalog";
import {
  computeItcSummary,
  dataSource,
  listApprovalComments,
  listApprovals,
  listBookings,
  listCompanies,
  listDepartments,
  listExpenseExports,
  listPoAllocations,
  listPortalUsers,
  listPurchaseOrders,
  type ApprovalDetail,
} from "@/lib/data";
import { partyStateCode, roundInr, stateName } from "@/lib/gst-engine";
import { latestPayments, paymentsEnabled } from "@/lib/payments/service";
import { DEPOSIT_RATE, depositFor } from "@/lib/quotes";
import { listRfps } from "@/lib/rfp/service";
import type { CorporateRole } from "@/lib/supabase/database.types";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { ApprovalDecisionForm } from "./_components/approval-decision-form";
import { ApprovalThread, type ThreadComment } from "./_components/approval-thread";
import { ItcCalculator } from "./_components/itc-calculator";
import { LiveBookings } from "./_components/live-bookings";
import { PayDepositButton } from "./_components/pay-deposit-button";
import { PoLedger } from "./_components/po-ledger";
import { RfpBroadcastForm } from "./_components/rfp-broadcast-form";
import { VenueExplorer } from "./_components/venue-explorer";

const ROLE_LABEL: Record<CorporateRole, string> = { ORGANIZER: "Organizer", APPROVER: "Approver", FINANCE_VIEWER: "Finance viewer" };
const ROLE_HELP: Record<CorporateRole, string> = {
  ORGANIZER: "Request events and follow their sign-off.",
  APPROVER: "Request events and sign off bookings assigned to you.",
  FINANCE_VIEWER: "Read-only: bookings, tax credit and expense receipts.",
};

const CLOCK = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/** One booking awaiting sign-off, with every approval tier on it. */
type SignOff = { bookingId: string; approvals: ApprovalDetail[] };

export default async function ClientPage({ searchParams }: PageProps<"/client">) {
  const member = await requirePortal("/client");
  const { company: companyParam, tab, deposit } = await searchParams;
  const allCompanies = await listCompanies();
  // Clients are pinned to their own company; admins may switch via ?company=<id>.
  const companies = member.role === "ADMIN" ? allCompanies : allCompanies.filter((c) => c.id === member.companyId);
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  const live = dataSource() === "supabase";
  const [bookings, catalog, users, allApprovals, exports, pos, poAllocations, departments] = await Promise.all([
    listBookings({ companyId: company.id }),
    getVenueCatalog(company.id),
    listPortalUsers({ companyId: company.id }),
    listApprovals({ tenantId: company.id }),
    listExpenseExports({ tenantId: company.id }),
    listPurchaseOrders({ tenantId: company.id }),
    listPoAllocations({ tenantId: company.id }),
    listDepartments({ companyIds: [company.id] }),
  ]);
  const [payments, holds, rfps, queue] = await Promise.all([
    latestPayments(bookings.map((b) => b.id)),
    activeHolds(bookings.map((b) => b.id)),
    live ? listRfps({ companyId: company.id }) : Promise.resolve([]),
    approvalQueue(member, company.id),
  ]);
  const itc = computeItcSummary(bookings);
  const canPay = paymentsEnabled();

  // The signed-in employee and their corporate role. Admins have none here: they
  // browse read-only and decide approvals on the Approvals page.
  const user = member.role === "CLIENT" ? users.find((u) => u.id === member.userId) : undefined;
  const role = user?.role ?? null;
  const canRequest = role === "ORGANIZER" || role === "APPROVER";

  // Open sign-offs: bookings still waiting, with all their tiers (decided and pending).
  const openBookingIds = new Set(bookings.filter((b) => b.status === "PENDING_APPROVAL").map((b) => b.id));
  const signOffs: SignOff[] = [...openBookingIds].map((bookingId) => ({
    bookingId,
    approvals: allApprovals.filter((a) => a.booking_id === bookingId).sort((a, b) => (a.tier ?? 1) - (b.tier ?? 1)),
  }));
  const threadAnchor = (s: SignOff) => s.approvals[0]?.id;
  const comments = await listApprovalComments(
    signOffs.map(threadAnchor).filter((id): id is string => Boolean(id)),
    company.id
  );
  const myTurn = (s: SignOff) =>
    role === "APPROVER" &&
    s.approvals.find(
      (a) =>
        a.status === "PENDING" &&
        a.approver_id === user?.id &&
        !s.approvals.some((x) => x.status === "PENDING" && (x.tier ?? 1) < (a.tier ?? 1))
    );
  const waitingOnMe = signOffs.filter((s) => myTurn(s)).length;

  const activeTab = tab === "signoffs" ? "signoffs" : tab === "pos" ? "pos" : "bookings";
  // Approvers manage their company's POs; admins any company's.
  const canManagePos = member.role === "ADMIN" || role === "APPROVER";
  const openPos = pos.filter((p) => p.status === "open").length;
  const exportByBooking = new Map(exports.map((e) => [e.booking_id, e]));
  const href = (params: { tab?: string }) => {
    const q = new URLSearchParams();
    if (member.role === "ADMIN") q.set("company", company.id);
    if (params.tab) q.set("tab", params.tab);
    return q.size ? `/client?${q}` : "/client";
  };

  return (
    <PortalShell
      portal="/client"
      title={company.legal_name}
      subtitle={`GSTIN ${company.gstin} · ${stateName(partyStateCode(company))} · monthly limit ${formatINR(Number(company.monthly_spend_limit_inr))}`}
      actions={
        queue.length > 0 ? (
          <Button asChild variant="outline">
            <Link href={member.role === "ADMIN" ? `/client/approvals?company=${company.id}` : "/client/approvals"}>
              <ClipboardCheck aria-hidden /> {queue.length} awaiting approval
            </Link>
          </Button>
        ) : null
      }
    >
      {companies.length > 1 ? (
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2" aria-label="Switch company (admin)">
          <span className="label-mono mr-1">Viewing</span>
          {companies.map((c) => (
            <Link key={c.id} href={`/client?company=${c.id}`} className={segmentClass(c.id === company.id)}>
              {c.legal_name.replace(" Private Limited", "")} ({partyStateCode(c)})
            </Link>
          ))}
        </div>
      ) : null}

      <p className="text-fg-subtle mb-8 text-[12.5px]">
        {user && role ? (
          <>
            Signed in as <span className="text-fg">{user.name}</span> · {ROLE_LABEL[role]}. {ROLE_HELP[role]}
          </>
        ) : (
          "Platform admin view: read-only here. Decide pending sign-offs from Approvals."
        )}
      </p>

      {deposit === "success" || deposit === "cancelled" ? (
        <p role="status" className="bg-surface-raised mb-6 rounded-lg px-4 py-3 text-[13px]">
          {deposit === "success"
            ? "Deposit authorised — it's captured only when the venue confirms. Status updates here in a moment."
            : "Checkout cancelled. Nothing was charged."}
        </p>
      ) : null}

      <nav className="border-line mb-6 flex gap-1 border-b" aria-label="Client portal sections">
        {(
          [
            { key: "bookings", label: "Bookings", count: 0 },
            { key: "signoffs", label: "Sign-offs", count: signOffs.length },
            { key: "pos", label: "Purchase orders", count: openPos },
          ] as const
        ).map((t) => (
          <Link
            key={t.key}
            href={href({ tab: t.key === "bookings" ? undefined : t.key })}
            aria-current={activeTab === t.key ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center gap-2 px-3 text-[13px] transition-colors",
              activeTab === t.key ? "text-fg font-medium" : "text-fg-subtle hover:text-fg"
            )}
          >
            {t.label}
            {t.key === "pos" && t.count > 0 ? <Badge variant="secondary">{t.count}</Badge> : null}
            {t.key === "signoffs" && t.count > 0 ? (
              <Badge variant={waitingOnMe > 0 ? "warning" : "secondary"}>{waitingOnMe > 0 ? `${waitingOnMe} for you` : t.count}</Badge>
            ) : null}
            {activeTab === t.key && <span aria-hidden className="bg-fg absolute inset-x-2 bottom-0 h-[2px] rounded-full" />}
          </Link>
        ))}
      </nav>

      {activeTab === "pos" ? (
        <PoLedger
          companyId={company.id}
          pos={pos}
          allocations={poAllocations}
          bookings={bookings.map((b) => ({
            id: b.id,
            label: `${b.venue.name} · ${formatDate(b.event_date)}`,
            status: b.status,
            eventDate: b.event_date,
            departmentId: b.department_id,
          }))}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          canManage={canManagePos}
        />
      ) : activeTab === "signoffs" ? (
        <div className="space-y-4">
          {signOffs.length === 0 ? (
            <Card>
              <CardContent className="text-fg-subtle py-6 text-center text-[13px]">No bookings are waiting for sign-off.</CardContent>
            </Card>
          ) : (
            signOffs.map((s) => {
              const b = bookings.find((x) => x.id === s.bookingId)!;
              const mine = myTurn(s);
              const anchor = threadAnchor(s);
              const thread: ThreadComment[] = comments
                .filter((c) => c.approval_id === anchor)
                .map((c) => ({ id: c.id, author: c.author_name, body: c.body, at: CLOCK.format(new Date(c.created_at)), mine: c.author_id === user?.id }));
              return (
                <Card key={s.bookingId}>
                  <CardHeader>
                    <CardTitle>
                      {b.venue.name} · {formatDate(b.event_date)}
                    </CardTitle>
                    <CardDescription>
                      {b.party_size} guests · {formatINR(b.budget_per_head_inr)}/head · {formatINR(b.total_amount_inr)} taxable · requested by{" "}
                      {s.approvals[0]?.requester_name ?? "—"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-fg-subtle flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px]">
                      <span>cc {b.cost_center ?? "—"}</span>
                      {b.project_code && <span>project {b.project_code}</span>}
                      {b.billing_gstin && <span>billed to {b.billing_gstin}</span>}
                    </p>
                    {s.approvals[0]?.reason && <p className="text-fg-muted text-[13px]">Needs sign-off because {s.approvals[0].reason}.</p>}

                    <ol className="space-y-2" aria-label="Sign-off chain">
                      {s.approvals.map((a) => {
                        const blocked = a.status === "PENDING" && s.approvals.some((x) => x.status === "PENDING" && (x.tier ?? 1) < (a.tier ?? 1));
                        return (
                          <li key={a.id} className="border-line flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5">
                            <span className="label-mono">Tier {a.tier ?? 1}</span>
                            <span className="text-fg text-[13px]">{a.approver_name}</span>
                            <span className="ml-auto">
                              {a.status === "APPROVED" ? (
                                <Badge variant="success">approved</Badge>
                              ) : a.status === "REJECTED" ? (
                                <Badge variant="destructive">rejected</Badge>
                              ) : blocked ? (
                                <Badge variant="secondary">waiting on tier {(a.tier ?? 2) - 1}</Badge>
                              ) : (
                                <Badge variant="warning">pending</Badge>
                              )}
                            </span>
                            {a.decision_note && <p className="text-fg-subtle w-full text-[12.5px]">“{a.decision_note}”</p>}
                          </li>
                        );
                      })}
                    </ol>

                    {mine && user ? (
                      <div className="bg-surface-raised rounded-lg p-4">
                        <p className="text-fg mb-2 text-[13px] font-medium">Your sign-off</p>
                        <ApprovalDecisionForm approvalId={mine.id} />
                      </div>
                    ) : null}

                    {anchor && <ApprovalThread approvalId={anchor} userId={user?.id} comments={thread} />}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <>
          <section aria-label="Booking status" className="mb-10 flex flex-wrap items-start justify-between gap-4">
            <dl className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
              {statusCounts(bookings).map((c) => (
                <div key={c.status} className="panel px-4 py-3">
                  <dt className="label-mono">{c.label}</dt>
                  <dd className={cn("mt-1.5 font-mono text-[22px] leading-none tabular-nums", c.count ? "text-fg" : "text-fg-faint")}>{c.count}</dd>
                </div>
              ))}
            </dl>
            <LiveBookings
              initial={bookings.map((b) => ({ id: b.id, status: b.status, venue: b.venue.name, eventDate: b.event_date }))}
              companyId={member.role === "ADMIN" ? company.id : undefined}
            />
          </section>

          {canRequest ? (
            <div className="mb-10 space-y-10">
              {live ? (
                <section aria-label="Plan an event">
                  <RfpBroadcastForm />
                </section>
              ) : null}
              <VenueExplorer venues={catalog.venues} company={{ id: company.id, gstin: company.gstin }} departments={catalog.departments} />
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="size-4" aria-hidden /> Expense receipts
                </CardTitle>
                <CardDescription>
                  Structured receipts exported to finance when a venue confirms a booking.
                  {canRequest ? "" : " You have read-only access; ask an Organizer to request events."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {exports.length === 0 ? (
                  <p className="text-fg-subtle text-[13px]">No receipts yet. They appear once a venue confirms a booking.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Exported</TableHead>
                        <TableHead>Cost centre</TableHead>
                        <TableHead className="text-right">Invoice total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exports.map((e) => {
                        const r = e.receipt as { expense?: { cost_center?: string | null; project_code?: string | null }; tax?: { invoice_total?: number } };
                        return (
                          <TableRow key={e.id}>
                            <TableCell className="font-mono text-[12px]">{CLOCK.format(new Date(e.created_at))}</TableCell>
                            <TableCell className="font-mono text-[12px]">
                              {r.expense?.cost_center ?? "—"}
                              {r.expense?.project_code && <span className="text-fg-subtle"> / {r.expense.project_code}</span>}
                            </TableCell>
                            <TableCell className="text-right font-mono">{formatINR(r.tax?.invoice_total ?? 0, true)}</TableCell>
                            <TableCell>
                              <Badge variant={e.status === "failed" ? "destructive" : e.status === "delivered" ? "success" : "outline"}>{e.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <a href={`/api/exports/${e.id}`} className="btn btn-ghost h-7 px-2 text-[12px]" download>
                                <Download className="size-3.5" aria-hidden /> JSON
                              </a>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>GST ITC savings</CardTitle>
                <CardDescription>18% GST on SAC 998596 is claimable as input tax credit.</CardDescription>
              </CardHeader>
              <CardContent>
                <ItcCalculator reclaimed={itc.reclaimed} pipeline={itc.pipeline} committedSpend={itc.committedSpend} />
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Your bookings</CardTitle>
              <CardDescription>{bookings.length} total</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event date</TableHead>
                    <TableHead>Venue</TableHead>
                    <TableHead>Cost centre</TableHead>
                    <TableHead className="text-right">Guests</TableHead>
                    <TableHead>GST</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">Invoice total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Receipt</TableHead>
                    {canPay ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((b) => {
                    const exp = exportByBooking.get(b.id);
                    const payment = payments.get(b.id);
                    const hold = holds.get(b.id);
                    const liveDeposit = payment && (payment.status === "authorized" || payment.status === "captured");
                    const listPerHead = b.list_budget_per_head_inr != null ? Number(b.list_budget_per_head_inr) : null;
                    const savings = listPerHead != null ? roundInr(Math.max(0, b.party_size * listPerHead - b.total_amount_inr)) : 0;
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="tabular-nums">{formatDate(b.event_date)}</TableCell>
                        <TableCell>
                          <div className="font-medium">{b.venue.name}</div>
                          <div className="text-fg-subtle text-xs">{b.venue.neighborhood}</div>
                        </TableCell>
                        <TableCell className="font-mono text-[12px]">
                          {b.cost_center ?? <span className="text-fg-faint">—</span>}
                          {b.project_code && <div className="text-fg-subtle">{b.project_code}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.party_size}</TableCell>
                        <TableCell>
                          <GstTypeBadge type={b.invoice.gst_type} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(b.total_amount_inr)}
                          {savings > 0 ? (
                            <div className="mt-1">
                              <RateCardPill label={`−${formatINR(savings)}`} />
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatINR(b.invoice.invoice_total)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <BookingStatusBadge status={b.status} />
                            {payment ? <PaymentStatusBadge status={payment.status} /> : null}
                          </div>
                          {hold && (b.status === "PENDING" || b.status === "PENDING_APPROVAL") ? (
                            <HoldCountdown createdAt={hold.holdStart} expiresAt={hold.expiresAt} className="mt-2 max-w-48" />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {exp ? (
                            <a href={`/api/exports/${exp.id}`} download className="text-fg inline-flex items-center gap-1 text-[12px] hover:underline">
                              <Download className="size-3" aria-hidden /> JSON
                            </a>
                          ) : (
                            <span className="text-fg-faint text-[12px]">—</span>
                          )}
                        </TableCell>
                        {canPay ? (
                          <TableCell className="text-right">
                            {/* PENDING = signed off (or in policy) and with the venue; deposits are taken then. */}
                            {canRequest && b.status === "PENDING" && !liveDeposit ? (
                              <PayDepositButton
                                bookingId={b.id}
                                label={`Pay ${formatINR(depositFor(b.invoice.invoice_total))} deposit (${Math.round(DEPOSIT_RATE * 100)}%)`}
                              />
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                  {bookings.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canPay ? 10 : 9} className="text-fg-subtle py-6 text-center">
                        No bookings yet{canRequest ? " — pick a venue above to send your first request" : ""}.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {rfps.length > 0 ? (
            <section className="mt-10 grid gap-4" aria-labelledby="rfp-heading">
              <div>
                <h2 id="rfp-heading" className="text-fg text-[15px] font-semibold tracking-tight">
                  RFP comparisons
                </h2>
                <p className="text-fg-subtle text-[13px]">Instant quotes from your packages and rate card; venues can counter-offer.</p>
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
        </>
      )}
    </PortalShell>
  );
}
