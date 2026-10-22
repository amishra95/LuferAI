import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ClipboardCheck, Download, Eye, FileSignature, NotebookPen, Plus, Receipt, ShieldCheck, Sparkles, Users } from "lucide-react";

import { CopyButton } from "@/components/portal/copy-button";
import { EmptyState } from "@/components/portal/empty-state";
import { HoldCountdown } from "@/components/portal/hold-countdown";
import { MarkdownMatrix } from "@/components/portal/markdown-matrix";
import { RateCardPill } from "@/components/portal/pills";
import { SpendLimitMeter } from "@/components/portal/spend-limit-meter";
import { PortalShell } from "@/components/portal/portal-shell";
import { segmentClass } from "@/components/portal/segment";
import { BookingStatusBadge, GstTypeBadge, PaymentStatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ManualBookingModal } from "@/components/bookings/manual-booking-modal";
import { ChatCompanyScope, ChatDrawerTrigger } from "@/components/ui/chat-drawer";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { activeHolds, approvalQueue } from "@/lib/approvals/service";
import { getAgent, syncAgentConfigs } from "@/lib/agents/store";
import { getLanguageModel } from "@/lib/ai/model";
import { requirePortal } from "@/lib/auth/session";
import { teamEventPrompt } from "@/lib/chat/concierge-link";
import { getUserPhone } from "@/lib/services/contact";
import { costCentreLock, receiptState } from "@/lib/bookings/expense-meta";
import { STAGE_LABEL } from "@/lib/bookings/lifecycle";
import { statusCounts } from "@/lib/bookings/live";
import { getVenueCatalog } from "@/lib/catalog";
import {
  computeItcSummary,
  countEventAttendees,
  dataSource,
  getCorporatePolicy,
  listApprovalComments,
  listApprovals,
  listBookings,
  listCompanies,
  listCatalogItems,
  listCatalogOrders,
  listDepartments,
  listExpenseExports,
  listPoAllocations,
  listPortalUsers,
  listPurchaseOrders,
  type ApprovalDetail,
} from "@/lib/data";
import { partyStateCode, roundInr, stateName, todayInIndia } from "@/lib/gst-engine";
import { listOrderSettlements, orderPaymentsEnabled } from "@/lib/marketplace/service";
import { STAGE_LABEL as SETTLEMENT_LABEL } from "@/lib/marketplace/settlement";
import { isOrderStatus, ORDER_STAGE_LABEL } from "@/lib/catalog/orders";
import { latestPayments, paymentsEnabled } from "@/lib/payments/service";
import { contractsForBookings } from "@/lib/services/contracts/contractStore";
import { STATUS_LABEL as CONTRACT_STATUS_LABEL } from "@/lib/services/contracts/lifecycle";
import { IssueContractButton } from "@/components/contracts/contract-actions";
import { DEPOSIT_RATE, depositFor } from "@/lib/quotes";
import { depositRatesForVenues } from "@/lib/venues/pricing-store";
import { MAX_BADGE_KM, officeOf } from "@/lib/venues/discovery";
import { searchVenuesSpatial } from "@/lib/actions/venue-search";
import { spendLimitFor } from "@/lib/policies/checkBookingPolicy";
import { listRfps } from "@/lib/rfp/service";
import type { CorporateRole } from "@/lib/supabase/database.types";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { ApprovalDecisionForm } from "./_components/approval-decision-form";
import { ApprovalThread, type ThreadComment } from "./_components/approval-thread";
import { CostCentreCell } from "./_components/cost-centre-cell";
import { ItcCalculator } from "./_components/itc-calculator";
import { LiveBookings } from "./_components/live-bookings";
import { PayDepositButton } from "./_components/pay-deposit-button";
import { CatalogShop } from "./_components/catalog-shop";
import { DirectQuoteCard } from "./_components/direct-quote-card";
import { DiscoveryPanel } from "./_components/discovery-panel";
import { PoLedger, type LedgerBooking } from "./_components/po-ledger";
import { RfpBroadcastForm } from "./_components/rfp-broadcast-form";
import { VenueExplorer } from "./_components/venue-explorer";
import { SettlementCard } from "@/components/finance/settlement-card";
import { settlementsFor } from "@/lib/finance/settlement-store";

const ROLE_LABEL: Record<CorporateRole, string> = { ORGANIZER: "Organizer", APPROVER: "Approver", FINANCE_VIEWER: "Finance viewer" };
const ROLE_HELP: Record<CorporateRole, string> = {
  ORGANIZER: "Request events and follow their sign-off.",
  APPROVER: "Request events and sign off bookings assigned to you.",
  FINANCE_VIEWER: "Read-only: bookings, tax credit and expense receipts.",
};

const MONTH = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

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
  const [bookings, catalog, users, allApprovals, exports, pos, poAllocations, departments, policy] = await Promise.all([
    listBookings({ companyId: company.id }),
    getVenueCatalog(company.id),
    listPortalUsers({ companyId: company.id }),
    listApprovals({ tenantId: company.id }),
    listExpenseExports({ tenantId: company.id }),
    listPurchaseOrders({ tenantId: company.id }),
    listPoAllocations({ tenantId: company.id }),
    listDepartments({ companyIds: [company.id] }),
    getCorporatePolicy(company.id),
  ]);
  const [catalogItems, catalogOrders] =
    tab === "catalog" ? await Promise.all([listCatalogItems(), listCatalogOrders({ tenantId: company.id })]) : tab === "pos" ? [[], await listCatalogOrders({ tenantId: company.id })] : [[], []];
  const orderSettlements = await listOrderSettlements(catalogOrders);
  const [payments, holds, rfps, queue, guestCounts, depositRate, contracts] = await Promise.all([
    latestPayments(bookings.map((b) => b.id)),
    activeHolds(bookings.map((b) => b.id)),
    live ? listRfps({ companyId: company.id }) : Promise.resolve([]),
    approvalQueue(member, company.id),
    countEventAttendees(bookings.map((b) => b.id)),
    // Venues may set their own deposit (/property → Pricing); checkout charges the same rate.
    live ? depositRatesForVenues(bookings.map((b) => b.venue_id)) : Promise.resolve(() => DEPOSIT_RATE),
    contractsForBookings(bookings.map((b) => b.id)),
  ]);
  const itc = computeItcSummary(bookings);
  // The concierge (/api/chat) needs a model and the workspace agent switched on.
  await syncAgentConfigs();
  const workspaceAgent = getAgent("workspace-agent");
  const concierge = !getLanguageModel({ backend: workspaceAgent?.model })
    ? { ready: false, reason: "The concierge needs an AI model configured (see Settings)." }
    : workspaceAgent?.enabled === false
      ? { ready: false, reason: "The concierge is switched off on the Agents page." }
      : { ready: true, reason: undefined };
  const canPay = paymentsEnabled();

  // The signed-in employee and their corporate role. Admins have none here: they
  // browse read-only and decide approvals on the Approvals page.
  const user = member.role === "CLIENT" ? users.find((u) => u.id === member.userId) : undefined;
  const role = user?.role ?? null;
  const canRequest = role === "ORGANIZER" || role === "APPROVER";
  // Office distances for the venue cards, from PostGIS (null: computed in the explorer).
  const office = officeOf(company);
  const nearby = canRequest && office ? await searchVenuesSpatial({ ...office, radiusMeters: MAX_BADGE_KM * 1000 }) : null;
  const officeDistances = nearby && Object.fromEntries(nearby.venues.map((v) => [v.id, v.distanceMeters]));
  // Prefills the request form's mobile with the one they gave last time.
  const requesterPhone = canRequest && user ? await getUserPhone(user.id) : null;

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

  const activeTab = tab === "signoffs" ? "signoffs" : tab === "pos" ? "pos" : tab === "catalog" ? "catalog" : tab === "settlement" ? "settlement" : "bookings";
  // Settlement: confirmed bookings onwards, most recent event first (loaded only on that tab).
  const settlements =
    activeTab === "settlement"
      ? await settlementsFor(company.id, bookings.filter((b) => ["CONFIRMED", "COMPLETED", "SETTLED"].includes(b.status)).sort((a, b) => b.event_date.localeCompare(a.event_date)))
      : [];
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
  const approvalsHref = member.role === "ADMIN" ? `/client/approvals?company=${company.id}` : "/client/approvals";
  // This month's committed spend against the limit: the figure the approval policy checks.
  const today = todayInIndia();
  const spendLimit = activeTab === "bookings" ? await spendLimitFor(company.id, today) : null;
  // Suggestions for the cost centre editor: the company's codes in use.
  const costCentres = [...new Set(bookings.map((b) => b.cost_center).filter((c): c is string => Boolean(c)))].sort();
  // "Browse marketplace" from an empty catalogue: the venue marketplace this viewer can use.
  const marketplaceHref = canRequest ? `${href({})}#venues-heading` : member.role === "ADMIN" ? "/venues" : null;

  return (
    <PortalShell
      portal="/client"
      title={company.legal_name}
      subtitle={`GSTIN ${company.gstin} · ${stateName(partyStateCode(company))} · monthly limit ${formatINR(Number(company.monthly_spend_limit_inr))}`}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {queue.length > 0 ? (
            <Button asChild variant="outline">
              <Link href={approvalsHref}>
                <ClipboardCheck aria-hidden /> {queue.length} awaiting approval
              </Link>
            </Button>
          ) : null}
          {/* Always offered, read-only admin view included: the chat is open to every client role and admins. */}
          <Button asChild variant="outline">
            <ChatDrawerTrigger companyId={company.id}>
              <Sparkles className="text-coral" aria-hidden /> Launch AI Assistant
            </ChatDrawerTrigger>
          </Button>
        </div>
      }
    >
      <ChatCompanyScope company={{ id: company.id, name: company.legal_name }} />
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

      {user && role ? (
        <p className="text-fg-subtle mb-8 text-meta">
          Signed in as <span className="text-fg">{user.name}</span> · {ROLE_LABEL[role]}. {ROLE_HELP[role]}
        </p>
      ) : (
        <div role="note" className="bg-surface-raised border-line mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5">
          <p className="text-fg-muted flex min-w-0 flex-1 items-center gap-2 text-meta">
            <ShieldCheck className="text-fg-subtle size-4 shrink-0" aria-hidden />
            <span>
              <span className="text-fg font-medium">Platform admin view: read-only here.</span>{" "}
              {queue.length > 0 ? `${queue.length} sign-off${queue.length === 1 ? " is" : "s are"} waiting; decide them from Approvals.` : "Nothing is waiting for sign-off."}
            </span>
          </p>
          {queue.length > 0 ? (
            <Button asChild size="sm">
              <Link href={approvalsHref}>
                Go to Pending Approvals <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      )}

      {deposit === "success" || deposit === "cancelled" ? (
        <p role="status" className="bg-surface-raised mb-6 rounded-lg px-4 py-3 text-meta">
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
            { key: "catalog", label: "Catalogue", count: 0 },
            { key: "pos", label: "Purchase orders", count: openPos },
            { key: "settlement", label: "Settlement", count: 0 },
          ] as const
        ).map((t) => (
          <Link
            key={t.key}
            href={href({ tab: t.key === "bookings" ? undefined : t.key })}
            aria-current={activeTab === t.key ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center gap-2 px-3 text-meta transition-colors",
              activeTab === t.key ? "text-fg font-medium" : "text-fg-subtle hover:text-fg"
            )}
          >
            {t.label}
            {t.key === "pos" && t.count > 0 ? <Badge variant="secondary">{t.count}</Badge> : null}
            {t.key === "signoffs" && t.count > 0 ? (
              <Badge variant={waitingOnMe > 0 ? "warning" : "secondary"}>{waitingOnMe > 0 ? `${waitingOnMe} for you` : t.count}</Badge>
            ) : null}
            {activeTab === t.key && <span aria-hidden className="bg-link absolute inset-x-2 bottom-0 h-[2px] rounded-full" />}
          </Link>
        ))}
      </nav>

      {activeTab === "catalog" ? (
        <CatalogShop
          items={catalogItems}
          orders={catalogOrders.map((o) => ({
            id: o.id,
            item_name: o.item_name,
            partner_name: o.partner_name,
            category: o.category,
            quantity: o.quantity,
            total_amount_inr: o.total_amount_inr,
            invoice_total: typeof (o.invoice as { invoice_total?: unknown } | null)?.invoice_total === "number" ? (o.invoice as { invoice_total: number }).invoice_total : null,
            status: o.status,
            event_date: o.event_date,
            needed_by: o.needed_by,
            tracking: o.tracking as { carrier?: string; reference?: string; url?: string } | null,
            created_at: o.created_at,
            ...(orderSettlements.has(o.id) && { payment: { stage: orderSettlements.get(o.id)!.stage, issues: orderSettlements.get(o.id)!.issues } }),
          }))}
          canOrder={canRequest}
          canPay={orderPaymentsEnabled()}
          canSync={member.role === "ADMIN" || role === "APPROVER"}
          today={today}
          marketplaceHref={marketplaceHref}
          readOnlyReason={member.role === "ADMIN" ? "Platform admins view this portal read-only." : "Only Organizers and Approvers can order."}
        />
      ) : activeTab === "settlement" ? (
        <section aria-labelledby="settlement-heading" className="grid gap-4">
          <div>
            <h2 id="settlement-heading" className="text-fg text-body font-semibold tracking-tight">
              Settlement
            </h2>
            <p className="text-fg-subtle text-caption">
              PO lines, GST as invoiced, input tax credit and exports to your expense or ERP system, for confirmed bookings.
              {member.role === "ADMIN" || role === "APPROVER" ? "" : " Approvers review ITC and send exports."}
            </p>
          </div>
          {settlements.length ? (
            settlements.map((s) => <SettlementCard key={s.bookingId} view={s} canAct={member.role === "ADMIN" || role === "APPROVER"} />)
          ) : (
            <EmptyState compact icon={Receipt} title="Nothing to settle yet" description="Bookings appear here once a venue confirms them." />
          )}
        </section>
      ) : activeTab === "pos" ? (
        <PoLedger
          companyId={company.id}
          pos={pos}
          allocations={poAllocations}
          bookings={bookings.map((b): LedgerBooking => ({
            id: b.id,
            kind: "booking" as const,
            label: `${b.venue.name} · ${formatDate(b.event_date)}`,
            status: b.status,
            statusLabel: STAGE_LABEL[b.status],
            eventDate: b.event_date,
            departmentId: b.department_id,
          })).concat(
            catalogOrders.map((o): LedgerBooking => {
              const st = orderSettlements.get(o.id);
              return {
                id: o.id,
                kind: "order" as const,
                label: `${o.quantity} × ${o.item_name}`,
                status: o.status,
                statusLabel: isOrderStatus(o.status) ? ORDER_STAGE_LABEL[o.status] : o.status,
                eventDate: o.event_date ?? o.needed_by ?? "",
                departmentId: o.department_id,
                ...(st && { reconciliation: { label: SETTLEMENT_LABEL[st.stage], issues: st.issues } }),
              };
            })
          )}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          canManage={canManagePos}
          readOnlyReason={role === "ORGANIZER" ? "Only Approvers can raise purchase orders." : "Finance viewers have read-only access to purchase orders."}
        />
      ) : activeTab === "signoffs" ? (
        <div className="space-y-6">
          {signOffs.length === 0 ? (
            <Card>
              <CardContent className="text-fg-subtle py-6 text-center text-meta">No bookings are waiting for sign-off.</CardContent>
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
                    <p className="text-fg-subtle flex flex-wrap gap-x-4 gap-y-1 font-mono text-caption">
                      <span>cc {b.cost_center ?? "—"}</span>
                      {b.project_code && <span>project {b.project_code}</span>}
                      {b.billing_gstin && <span>billed to {b.billing_gstin}</span>}
                    </p>
                    {s.approvals[0]?.reason && <p className="text-fg-muted text-meta">Needs sign-off because {s.approvals[0].reason}.</p>}

                    <ol className="space-y-2" aria-label="Sign-off chain">
                      {s.approvals.map((a) => {
                        const blocked = a.status === "PENDING" && s.approvals.some((x) => x.status === "PENDING" && (x.tier ?? 1) < (a.tier ?? 1));
                        return (
                          <li key={a.id} className="border-line flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5">
                            <span className="label-mono">Tier {a.tier ?? 1}</span>
                            <span className="text-fg text-meta">{a.approver_name}</span>
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
                            {a.decision_note && <p className="text-fg-subtle w-full text-meta">“{a.decision_note}”</p>}
                          </li>
                        );
                      })}
                    </ol>

                    {mine && user ? (
                      <div className="bg-surface-raised rounded-lg p-4">
                        <p className="text-fg mb-2 text-meta font-medium">Your sign-off</p>
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
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-section text-fg font-semibold">Bookings</h2>
            {/* Everyone here: admins file on behalf of an employee, finance viewers get the concierge (see the modal). */}
            {member.role === "ADMIN" || member.role === "CLIENT" ? (
              <div className="flex flex-wrap items-center gap-2">
                <ManualBookingModal
                  companyId={company.id}
                  trigger={
                    <Button variant="outline" className="rounded-full px-5 font-medium has-[>svg]:px-5">
                      <NotebookPen aria-hidden /> New manual RFP
                    </Button>
                  }
                />
                <Button asChild className="rounded-full px-5 font-medium has-[>svg]:px-5">
                  <ChatDrawerTrigger companyId={company.id} prompt={teamEventPrompt(company.legal_name)}>
                    <Plus aria-hidden /> Request team event
                  </ChatDrawerTrigger>
                </Button>
              </div>
            ) : null}
          </div>

          <section aria-label="Booking status" className="mb-10 flex flex-wrap items-start justify-between gap-4">
            <dl className="grid flex-1 grid-cols-2 gap-6 sm:grid-cols-4">
              {statusCounts(bookings).map((c) => (
                <div key={c.status} className="panel p-5">
                  <dt className="label-mono">{c.label}</dt>
                  <dd className={cn("mt-1.5 font-mono text-title leading-none tabular-nums", c.count ? "text-fg" : "text-fg-faint")}>{c.count}</dd>
                </div>
              ))}
            </dl>
            <LiveBookings
              initial={bookings.map((b) => ({ id: b.id, status: b.status, venue: b.venue.name, eventDate: b.event_date }))}
              companyId={member.role === "ADMIN" ? company.id : undefined}
            />
          </section>

          {spendLimit ? <SpendLimitMeter committed={spendLimit.month_to_date} limit={spendLimit.monthly_limit} month={MONTH.format(new Date(`${today}T12:00:00+05:30`))} className="-mt-6 mb-10" /> : null}

          {canRequest ? (
            <div className="mb-10 space-y-10">
              <DiscoveryPanel offline={!concierge.ready} reason={concierge.reason} />
              {live ? (
                <section aria-label="Plan an event">
                  <RfpBroadcastForm />
                </section>
              ) : null}
              <VenueExplorer
                venues={catalog.venues}
                company={{ id: company.id, gstin: company.gstin }}
                departments={catalog.departments}
                defaultPhone={requesterPhone ?? undefined}
                policy={
                  policy && {
                    max_budget_per_head: policy.max_budget_per_head,
                    requires_approval_above: policy.requires_approval_above,
                    high_value_threshold: policy.high_value_threshold,
                    auto_approval_limit_per_head: policy.auto_approval_limit_per_head,
                    manager_approval_limit_per_head: policy.manager_approval_limit_per_head,
                    max_office_distance_km: policy.max_office_distance_km,
                  }
                }
                office={office}
                officeDistances={officeDistances}
              />
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
                  <EmptyState compact icon={Receipt} title="No receipts yet" description="A structured receipt goes to your finance system when a venue confirms a booking; it'll be listed here." />
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
                            <TableCell className="font-mono text-caption">{CLOCK.format(new Date(e.created_at))}</TableCell>
                            <TableCell className="font-mono text-caption">
                              {r.expense?.cost_center ?? "—"}
                              {r.expense?.project_code && <span className="text-fg-subtle"> / {r.expense.project_code}</span>}
                            </TableCell>
                            <TableCell className="text-right font-mono">{formatINR(r.tax?.invoice_total ?? 0, true)}</TableCell>
                            <TableCell>
                              <Badge variant={e.status === "failed" ? "destructive" : e.status === "delivered" ? "success" : "outline"}>{e.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <a href={`/api/exports/${e.id}`} className="btn btn-ghost h-7 px-2 text-caption" download>
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
                <ItcCalculator eligible={itc.eligible} pendingReview={itc.pendingReview} awaitingInvoice={itc.awaitingInvoice} blocked={itc.blocked} committedSpend={itc.committedSpend} />
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Your bookings</CardTitle>
              <CardDescription>{bookings.length} total{bookings.length ? " · open a row for its event workspace" : ""}</CardDescription>
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
                    // Cancelled bookings without guests have no workspace to open.
                    const workspace = b.status !== "CANCELLED" || guestCounts.has(b.id);
                    const receipt = receiptState(b.status, exp?.status ?? null);
                    const ccLock = !canRequest ? (member.role === "ADMIN" ? "Platform admins view this portal read-only." : "Finance viewers can't change cost centres.") : costCentreLock(b.status, Boolean(exp));
                    return (
                      // The venue link stretches over the row (after:inset-0); controls sit above it (relative z-10).
                      <TableRow key={b.id} className={cn("relative", workspace && "hover:bg-surface-hover cursor-pointer")}>
                        <TableCell className="tabular-nums">{formatDate(b.event_date)}</TableCell>
                        <TableCell>
                          {workspace ? (
                            <Link
                              href={`/client/events/${b.id}`}
                              className="font-medium after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                            >
                              {b.venue.name}
                              <span className="sr-only">, {formatDate(b.event_date)}: open event workspace</span>
                            </Link>
                          ) : (
                            <div className="font-medium">{b.venue.name}</div>
                          )}
                          <div className="text-fg-subtle text-caption">{b.venue.neighborhood}</div>
                          {workspace ? (
                            <span className="text-fg-muted mt-1 inline-flex items-center gap-1 text-caption">
                              <Users className="size-3" aria-hidden />
                              {guestCounts.get(b.id) ? `${guestCounts.get(b.id)} guests` : "Plan guests"}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="relative z-10">
                          <CostCentreCell bookingId={b.id} value={b.cost_center} projectCode={b.project_code} listId="client-cost-centres" locked={ccLock} />
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
                            <BookingStatusBadge status={b.status} audience="client" />
                            {payment ? <PaymentStatusBadge status={payment.status} /> : null}
                          </div>
                          {b.status === "CONFIRMED" || b.status === "COMPLETED" || b.status === "SETTLED" ? (
                            <Link href={`/client/events/${b.id}`} className="text-fg-subtle hover:text-fg relative z-10 mt-1.5 inline-flex items-center gap-1 text-caption underline-offset-2 hover:underline">
                              <Receipt className="size-3" aria-hidden /> Voucher &amp; invoice
                            </Link>
                          ) : null}
                          {hold && (b.status === "PENDING" || b.status === "PENDING_APPROVAL") ? (
                            <HoldCountdown createdAt={hold.holdStart} expiresAt={hold.expiresAt} className="mt-2 max-w-48" />
                          ) : null}
                          {contracts.get(b.id) ? (
                            <Link href={`/contracts/${contracts.get(b.id)!.id}`} className="text-fg-subtle hover:text-fg relative z-10 mt-1.5 inline-flex items-center gap-1 text-caption underline-offset-2 hover:underline">
                              <FileSignature className="size-3" aria-hidden /> {CONTRACT_STATUS_LABEL[contracts.get(b.id)!.status]}
                            </Link>
                          ) : company.contracts_required && canRequest && b.status === "PENDING" ? (
                            <IssueContractButton bookingId={b.id} className="relative z-10 mt-1.5 h-7 px-2 text-caption" />
                          ) : null}
                        </TableCell>
                        <TableCell className="relative z-10">
                          {exp ? (
                            <a href={`/api/exports/${exp.id}`} download title={receipt.hint} className="inline-flex items-center gap-1.5 hover:underline">
                              <Badge variant={receipt.kind === "failed" ? "destructive" : "success"}>{receipt.label}</Badge>
                              <Download className="text-fg-subtle size-3" aria-label="Download receipt JSON" />
                            </a>
                          ) : receipt.kind === "none" ? (
                            <span title={receipt.hint} className="text-fg-faint text-caption">
                              {receipt.label}
                            </span>
                          ) : (
                            <span title={receipt.hint}>
                              <Badge variant={receipt.kind === "pending" ? "warning" : "outline"}>{receipt.label}</Badge>
                            </span>
                          )}
                        </TableCell>
                        {canPay ? (
                          <TableCell className="relative z-10 text-right">
                            {/* PENDING = signed off (or in policy) and with the venue; deposits are taken then. */}
                            {canRequest && b.status === "PENDING" && !liveDeposit ? (
                              <PayDepositButton
                                bookingId={b.id}
                                label={`Pay ${formatINR(depositFor(b.invoice.invoice_total, depositRate(b.venue_id)))} deposit (${Math.round(depositRate(b.venue_id) * 1000) / 10}%)`}
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
              <datalist id="client-cost-centres">
                {costCentres.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </CardContent>
          </Card>

          {rfps.length > 0 ? (
            <section className="mt-10 grid gap-4" aria-labelledby="rfp-heading">
              <div>
                <h2 id="rfp-heading" className="text-fg text-body font-semibold tracking-tight">
                  RFP comparisons
                </h2>
                <p className="text-fg-subtle text-meta">Instant quotes from your packages and rate card; venues can counter-offer.</p>
              </div>
              {rfps.map(({ rfp, markdown, columns }) =>
                rfp.origin === "venue" && columns[0] ? (
                  <Card key={rfp.id} className="gap-3">
                    <CardHeader className="flex flex-row flex-wrap items-center gap-2">
                      <CardTitle className="text-body">Direct quote from {columns[0].venue.name}</CardTitle>
                      <Badge variant={rfp.status === "open" ? "warning" : "secondary"}>{rfp.status === "open" ? "Open" : rfp.status === "awarded" ? "Booked" : "Closed"}</Badge>
                      <CardDescription className="flex-1 text-right">{formatDate(rfp.created_at.slice(0, 10))}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <DirectQuoteCard
                        responseId={columns[0].response_id ?? ""}
                        venueName={columns[0].venue.name}
                        neighborhood={columns[0].venue.neighborhood}
                        eventDate={rfp.event_date}
                        partySize={rfp.party_size}
                        perHead={columns[0].per_head_inr}
                        packageName={columns[0].package_name}
                        invoiceTotal={columns[0].price?.invoice.invoice_total ?? null}
                        notes={columns[0].notes}
                        status={rfp.status}
                        canBook={canRequest}
                      />
                    </CardContent>
                  </Card>
                ) : (
                <Card key={rfp.id} className="gap-3">
                  <CardHeader className="flex flex-row flex-wrap items-center gap-2">
                    <CardTitle className="text-body">{formatDate(rfp.created_at.slice(0, 10))}</CardTitle>
                    <CardDescription className="line-clamp-1 flex-1">{rfp.brief}</CardDescription>
                    <CopyButton text={markdown} label="Copy Markdown" />
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <MarkdownMatrix markdown={markdown} />
                  </CardContent>
                </Card>
                )
              )}
            </section>
          ) : null}
        </>
      )}
    </PortalShell>
  );
}
