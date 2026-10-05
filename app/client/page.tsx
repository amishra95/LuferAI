import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalShell } from "@/components/portal/portal-shell";
import { BookingStatusBadge, GstTypeBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  computeItcSummary,
  listApprovalChain,
  listApprovals,
  listBookings,
  listCompanies,
  listPortalUsers,
  listVenues,
} from "@/lib/data";
import { partyStateCode, stateName } from "@/lib/gst-engine";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { ApprovalDecisionForm } from "./_components/approval-decision-form";
import { RequestEventPanel } from "./_components/request-event-panel";
import { ItcCalculator } from "./_components/itc-calculator";

export default async function ClientPage({ searchParams }: PageProps<"/client">) {
  const { company: companyParam, user: userParam, tab } = await searchParams;
  const companies = await listCompanies();
  // Until sign-in exists, the acting company is chosen via ?company=<id>.
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  const [bookings, venues, users, chain] = await Promise.all([
    listBookings({ companyId: company.id }),
    listVenues(),
    listPortalUsers({ companyId: company.id }),
    listApprovalChain(company.id),
  ]);
  const itc = computeItcSummary(bookings);

  // Until sign-in exists, the acting employee is chosen via ?user=<id>.
  const user = (typeof userParam === "string" ? users.find((u) => u.id === userParam) : undefined) ?? users[0];
  const isApprover = Boolean(user && chain.some((c) => c.approver_user_id === user.id));
  const approvals =
    user && isApprover ? await listApprovals({ tenantId: company.id, approverId: user.id, status: "PENDING" }) : [];
  const activeTab = isApprover && tab === "approvals" ? "approvals" : "bookings";
  const href = (params: { user?: string; tab?: string }) => {
    const q = new URLSearchParams({ company: company.id });
    if (params.user) q.set("user", params.user);
    if (params.tab) q.set("tab", params.tab);
    return `/client?${q}`;
  };

  return (
    <PortalShell
      portal="/client"
      title={company.legal_name}
      subtitle={`GSTIN ${company.gstin} · ${stateName(partyStateCode(company))} · monthly limit ${formatINR(Number(company.monthly_spend_limit_inr))}`}
    >
      {companies.length > 1 ? (
        <div className="-mt-4 mb-6 flex flex-wrap gap-2 text-sm" aria-label="Switch company (demo)">
          <span className="text-muted-foreground">Viewing as:</span>
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/client?company=${c.id}`}
              className={cn(
                "rounded-md border px-2 py-0.5",
                c.id === company.id ? "bg-accent text-accent-foreground border-transparent" : "hover:bg-muted"
              )}
            >
              {c.legal_name.replace(" Private Limited", "")} ({partyStateCode(c)})
            </Link>
          ))}
        </div>
      ) : null}

      {users.length > 0 ? (
        <div className="-mt-2 mb-6 flex flex-wrap gap-2 text-sm" aria-label="Switch user (demo)">
          <span className="text-muted-foreground">Acting as:</span>
          {users.map((u) => (
            <Link
              key={u.id}
              href={href({ user: u.id })}
              className={cn(
                "rounded-md border px-2 py-0.5",
                u.id === user?.id ? "bg-accent text-accent-foreground border-transparent" : "hover:bg-muted"
              )}
            >
              {u.name}
            </Link>
          ))}
        </div>
      ) : null}

      {isApprover ? (
        <nav className="mb-6 flex gap-1 border-b" aria-label="Client portal sections">
          {(
            [
              { key: "bookings", label: "Bookings" },
              { key: "approvals", label: "Approvals needed" },
            ] as const
          ).map((t) => (
            <Link
              key={t.key}
              href={href({ user: user?.id, tab: t.key === "approvals" ? "approvals" : undefined })}
              aria-current={activeTab === t.key ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
                activeTab === t.key
                  ? "border-primary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              )}
            >
              {t.label}
              {t.key === "approvals" && approvals.length > 0 ? <Badge variant="warning">{approvals.length}</Badge> : null}
            </Link>
          ))}
        </nav>
      ) : null}

      {activeTab === "approvals" && user ? (
        <Card>
          <CardHeader>
            <CardTitle>Approvals needed</CardTitle>
            <CardDescription>
              Bookings outside {company.legal_name.replace(" Private Limited", "")}&apos;s policy wait here for your sign-off.
              Approving sends them to the venue; rejecting cancels them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {approvals.length === 0 ? (
              <p className="text-muted-foreground py-4 text-sm">Nothing waiting for you.</p>
            ) : (
              <ul className="divide-y">
                {approvals.map((a) => (
                  <li key={a.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start">
                    <div className="flex-1">
                      <div className="font-medium">
                        {a.booking.venue_name} · {formatDate(a.booking.event_date)}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {a.booking.party_size} guests · {formatINR(a.booking.budget_per_head_inr)}/head ·{" "}
                        {formatINR(a.booking.total_amount_inr)} taxable
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        Requested by {a.requester_name} on {formatDate(a.created_at.slice(0, 10))}
                      </div>
                      {a.reason ? <p className="mt-2 text-sm">{a.reason}</p> : null}
                    </div>
                    <ApprovalDecisionForm approvalId={a.id} userId={user.id} companyId={company.id} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Request an event</CardTitle>
                <CardDescription>
                  The venue reviews your request; GST is worked out from your GSTIN and the venue&apos;s.
                </CardDescription>
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
                    <TableHead className="text-right">Guests</TableHead>
                    <TableHead>GST</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Invoice total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="tabular-nums">{formatDate(b.event_date)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{b.venue.name}</div>
                        <div className="text-muted-foreground text-xs">{b.venue.neighborhood}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.party_size}</TableCell>
                      <TableCell>
                        <GstTypeBadge type={b.invoice.gst_type} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(b.total_amount_inr)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(b.invoice.total_tax)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatINR(b.invoice.invoice_total)}</TableCell>
                      <TableCell>
                        <BookingStatusBadge status={b.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {bookings.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-muted-foreground py-6 text-center">
                        No bookings yet — send your first request above.
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
