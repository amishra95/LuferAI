import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Eye } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { segmentClass } from "@/components/portal/segment";
import { BookingStatusBadge, GstTypeBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  computeItcSummary,
  listApprovalComments,
  listApprovals,
  listBookings,
  listCompanies,
  listExpenseExports,
  listPortalUsers,
  listVenues,
  type ApprovalDetail,
} from "@/lib/data";
import { partyStateCode, stateName } from "@/lib/gst-engine";
import type { CorporateRole } from "@/lib/supabase/database.types";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { ApprovalDecisionForm } from "./_components/approval-decision-form";
import { ApprovalThread, type ThreadComment } from "./_components/approval-thread";
import { ItcCalculator } from "./_components/itc-calculator";
import { RequestEventPanel } from "./_components/request-event-panel";

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
  const { company: companyParam, user: userParam, tab } = await searchParams;
  const companies = await listCompanies();
  // Until sign-in exists, the acting company is chosen via ?company=<id>.
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  const [bookings, venues, users, allApprovals, exports] = await Promise.all([
    listBookings({ companyId: company.id }),
    listVenues(),
    listPortalUsers({ companyId: company.id }),
    listApprovals({ tenantId: company.id }),
    listExpenseExports({ tenantId: company.id }),
  ]);
  const itc = computeItcSummary(bookings);

  // Until sign-in exists, the acting employee is chosen via ?user=<id>.
  const user = (typeof userParam === "string" ? users.find((u) => u.id === userParam) : undefined) ?? users[0];
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

  const activeTab = tab === "signoffs" ? "signoffs" : "bookings";
  const exportByBooking = new Map(exports.map((e) => [e.booking_id, e]));
  const href = (params: { user?: string; tab?: string }) => {
    const q = new URLSearchParams({ company: company.id });
    if (params.user) q.set("user", params.user);
    if (params.tab) q.set("tab", params.tab);
    return `/client?${q}`;
  };

  return (
    <PortalShell
      title={company.legal_name}
      subtitle={`GSTIN ${company.gstin} · ${stateName(partyStateCode(company))} · monthly limit ${formatINR(Number(company.monthly_spend_limit_inr))}`}
    >
      {companies.length > 1 ? (
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2" aria-label="Switch company (demo)">
          <span className="label-mono mr-1">Viewing as</span>
          {companies.map((c) => (
            <Link key={c.id} href={`/client?company=${c.id}`} className={segmentClass(c.id === company.id)}>
              {c.legal_name.replace(" Private Limited", "")} ({partyStateCode(c)})
            </Link>
          ))}
        </div>
      ) : null}

      {users.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Switch user (demo)">
          <span className="label-mono mr-1">Acting as</span>
          {users.map((u) => (
            <Link key={u.id} href={href({ user: u.id, tab: activeTab === "signoffs" ? "signoffs" : undefined })} className={segmentClass(u.id === user?.id)}>
              {u.name.replace(/\s*\(.*\)$/, "")}
              {u.role && <span className="ml-1.5 font-mono text-[10.5px] opacity-70">{ROLE_LABEL[u.role]}</span>}
            </Link>
          ))}
        </div>
      ) : null}
      {role && <p className="text-fg-subtle mb-8 text-[12.5px]">{ROLE_HELP[role]}</p>}

      <nav className="border-line mb-6 flex gap-1 border-b" aria-label="Client portal sections">
        {(
          [
            { key: "bookings", label: "Bookings", count: 0 },
            { key: "signoffs", label: "Sign-offs", count: signOffs.length },
          ] as const
        ).map((t) => (
          <Link
            key={t.key}
            href={href({ user: user?.id, tab: t.key === "signoffs" ? "signoffs" : undefined })}
            aria-current={activeTab === t.key ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center gap-2 px-3 text-[13px] transition-colors",
              activeTab === t.key ? "text-fg font-medium" : "text-fg-subtle hover:text-fg"
            )}
          >
            {t.label}
            {t.key === "signoffs" && t.count > 0 ? (
              <Badge variant={waitingOnMe > 0 ? "warning" : "secondary"}>{waitingOnMe > 0 ? `${waitingOnMe} for you` : t.count}</Badge>
            ) : null}
            {activeTab === t.key && <span aria-hidden className="bg-copper-deep absolute inset-x-2 bottom-0 h-[2px] rounded-full" />}
          </Link>
        ))}
      </nav>

      {activeTab === "signoffs" ? (
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
                          <li key={a.id} className="border-line flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5">
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
                      <div className="bg-surface-raised rounded-xl p-4">
                        <p className="text-fg mb-2 text-[13px] font-medium">Your sign-off</p>
                        <ApprovalDecisionForm approvalId={mine.id} userId={user.id} companyId={company.id} />
                      </div>
                    ) : null}

                    {anchor && <ApprovalThread approvalId={anchor} companyId={company.id} userId={user?.id} comments={thread} />}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-5">
            {canRequest ? (
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle>Request an event</CardTitle>
                  <CardDescription>The venue reviews your request; GST is worked out from the billed GSTIN and the venue&apos;s.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RequestEventPanel
                    key={`${company.id}:${user?.id ?? ""}`}
                    companyId={company.id}
                    userId={user?.id}
                    companyGstin={company.gstin}
                    venues={venues.map(({ id, name, neighborhood, city, gstin, capacity_max, min_spend_inr, pdr_available }) => ({
                      id,
                      name,
                      neighborhood,
                      city,
                      gstin,
                      capacity_max,
                      min_spend_inr: Number(min_spend_inr),
                      pdr_available,
                    }))}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="size-4" aria-hidden /> Expense receipts
                  </CardTitle>
                  <CardDescription>
                    Structured receipts exported to finance when a venue confirms a booking. You have read-only access; ask an Organizer to request events.
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
            )}

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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((b) => {
                    const exp = exportByBooking.get(b.id);
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
                        <TableCell className="text-right tabular-nums">{formatINR(b.total_amount_inr)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatINR(b.invoice.invoice_total)}</TableCell>
                        <TableCell>
                          <BookingStatusBadge status={b.status} />
                        </TableCell>
                        <TableCell>
                          {exp ? (
                            <a href={`/api/exports/${exp.id}`} download className="text-copper-ink inline-flex items-center gap-1 text-[12px] hover:underline">
                              <Download className="size-3" aria-hidden /> JSON
                            </a>
                          ) : (
                            <span className="text-fg-faint text-[12px]">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {bookings.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-fg-subtle py-6 text-center">
                        No bookings yet{canRequest ? " — send your first request above" : ""}.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </PortalShell>
  );
}
