import Link from "next/link";
import { ArrowLeft, Building, CalendarRange, CheckCircle2, History, Plus, Store, Tag, Users } from "lucide-react";

import { EmptyState } from "@/components/portal/empty-state";

import { PortalShell } from "@/components/portal/portal-shell";
import { segmentClass } from "@/components/portal/segment";
import { StatCard } from "@/components/portal/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PARTNER_ROLE_LABEL, partnerPermissions } from "@/lib/auth/partner-rbac";
import { requirePortal } from "@/lib/auth/session";
import { todayInIndia } from "@/lib/gst-engine";
import { getPartner, listAudit, listPartnerMembers, listPartnerRateCards, listPartners, listPartnerVenues } from "@/lib/partner/service";
import { listCatalogItems, listCatalogOrders } from "@/lib/data";
import { fromPerHead, isRateActiveOn } from "@/lib/partner/validation";
import { cn, formatDate, formatINR } from "@/lib/utils";
import {
  DeleteListingButton,
  DeleteRateButton,
  InviteForm,
  ListingForm,
  ListingStatusButton,
  MemberRoleForm,
  RateCardForm,
} from "./_components/partner-forms";
import { LowStock, PartnerCatalog, PartnerOrders, type FulfilOrder } from "./_components/catalog-manager";
import { PartnerPayouts } from "./_components/payouts";
import { listOrderSettlements, listPartnerTcs, orderPaymentsEnabled, type OrderSettlement } from "@/lib/marketplace/service";

const TABS = [
  { key: "listings", label: "Listings", permission: "partner.view" },
  { key: "rates", label: "Rate cards", permission: "partner.view" },
  { key: "catalog", label: "Catalogue", permission: "partner.view" },
  { key: "orders", label: "Orders", permission: "partner.view" },
  { key: "payouts", label: "Payouts", permission: "payouts.view" },
  { key: "team", label: "Team", permission: "team.manage" },
  { key: "activity", label: "Activity", permission: "audit.view" },
] as const;

const CLOCK = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export default async function PartnerPage({ searchParams }: PageProps<"/partner">) {
  const member = await requirePortal("/partner");
  const { partner: partnerParam, tab, listing: listingParam, created } = await searchParams;
  const can = partnerPermissions(member);
  const isAdmin = member.role === "ADMIN";

  // Partner users see their own organisation; admins pick one via ?partner=<id>.
  const partners = isAdmin ? await listPartners() : [];
  const partnerId = isAdmin
    ? (typeof partnerParam === "string" && partners.some((p) => p.id === partnerParam) ? partnerParam : partners[0]?.id) ?? null
    : member.partnerId;
  const partner = partnerId ? await getPartner(partnerId) : null;

  if (!partner) {
    return (
      <PortalShell portal="/partner" title="Partner extranet" subtitle="Supplier listings and rate cards">
        <Card>
          <CardContent className="text-fg-subtle py-8 text-center text-meta">
            {isAdmin
              ? "No partners yet. Create a row in the partners table, then invite its first Owner from the Team tab."
              : "Your partner account isn't set up yet. Ask your Lufer.ai contact to finish onboarding."}
          </CardContent>
        </Card>
      </PortalShell>
    );
  }

  // Forms send partner_id only for admins; the server ignores it for partner users anyway.
  const formPartnerId = isAdmin ? partner.id : null;
  const visibleTabs = TABS.filter((t) => can.has(t.permission));
  const activeTab = visibleTabs.find((t) => t.key === tab)?.key ?? "listings";
  const href = (t: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    if (isAdmin) q.set("partner", partner.id);
    if (t !== "listings") q.set("tab", t);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return q.size ? `/partner?${q}` : "/partner";
  };
  /** One listing, opened inside the Rate cards tab. */
  const listingHref = (id: string) => href("rates", { listing: id });
  const canAddListing = can.has("listing.edit");

  const today = todayInIndia();
  const [listings, rates, members, audit, catalogItems, orders] = await Promise.all([
    listPartnerVenues(partner.id),
    listPartnerRateCards(partner.id),
    activeTab === "team" ? listPartnerMembers(partner.id) : Promise.resolve([]),
    activeTab === "activity" ? listAudit(partner.id) : Promise.resolve([]),
    activeTab === "catalog" || activeTab === "orders" ? listCatalogItems({ partnerId: partner.id, includePaused: true }) : Promise.resolve([]),
    activeTab === "orders" || activeTab === "payouts" ? listCatalogOrders({ partnerId: partner.id }) : Promise.resolve([]),
  ]);
  const [settlements, tcs] = await Promise.all([
    activeTab === "orders" || activeTab === "payouts" ? listOrderSettlements(orders) : Promise.resolve(new Map<string, OrderSettlement>()),
    activeTab === "payouts" ? listPartnerTcs(partner.id) : Promise.resolve([]),
  ]);
  const liveRates = rates.filter((r) => isRateActiveOn(r, today) || r.valid_from > today);
  // A listing opened from the Listings tab (or just created): only this partner's.
  const selected = activeTab === "rates" && typeof listingParam === "string" ? (listings.find((l) => l.id === listingParam) ?? null) : null;
  const justCreated = Boolean(selected) && created === "1";
  const shownRates = selected ? rates.filter((r) => r.partner_venue_id === selected.id) : rates;
  const listingName = new Map(listings.map((l) => [l.id, l.name]));
  const roleLabel = isAdmin ? "Lufer.ai admin" : member.partnerRole ? PARTNER_ROLE_LABEL[member.partnerRole] : "";

  return (
    <PortalShell
      portal="/partner"
      title={partner.name}
      subtitle={`Partner extranet · ${roleLabel}${partner.status === "suspended" ? " · suspended: listings are hidden from search" : ""}`}
      actions={
        canAddListing ? (
          <Link href={`${href("listings")}#add-listing`} className="btn btn-secondary h-8 px-3 text-meta">
            <Plus className="size-3.5" aria-hidden /> Add listing
          </Link>
        ) : null
      }
    >
      {isAdmin && partners.length > 1 ? (
        <div className="-mt-2 mb-6 flex flex-wrap items-center gap-2" aria-label="Switch partner (admin)">
          <span className="label-mono mr-1">Viewing</span>
          {partners.map((p) => (
            <Link key={p.id} href={`/partner?partner=${p.id}`} className={segmentClass(p.id === partner.id)}>
              {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      <section className="mb-6 grid gap-6 sm:grid-cols-3" aria-label="Summary">
        <StatCard label="Live listings" value={String(listings.filter((l) => l.status === "active").length)} hint={`${listings.length} total`} icon={Store} />
        <StatCard label="Rates in effect" value={String(rates.filter((r) => isRateActiveOn(r, today)).length)} hint={`${liveRates.length} current or upcoming`} icon={CalendarRange} />
        <StatCard label="Your role" value={roleLabel} hint={can.has("rates.edit") ? "Can edit listings and rates" : "Read-only, can pause listings"} icon={can.has("team.manage") ? Users : Building} />
      </section>

      <nav className="border-line mb-6 flex gap-1 border-b" aria-label="Partner sections">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={activeTab === t.key ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center px-3 text-meta transition-colors",
              activeTab === t.key ? "text-fg font-medium" : "text-fg-subtle hover:text-fg"
            )}
          >
            {t.label}
            {activeTab === t.key && <span aria-hidden className="bg-link absolute inset-x-2 bottom-0 h-[2px] rounded-full" />}
          </Link>
        ))}
      </nav>

      {activeTab === "listings" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Listings</CardTitle>
              <CardDescription>Active listings appear in Lufer.ai venue search as partner venues. Paused ones are hidden.</CardDescription>
            </CardHeader>
            <CardContent>
              {listings.length === 0 ? (
                <EmptyState
                  compact
                  icon={Store}
                  title="No listings yet"
                  description={canAddListing ? "Add your first venue, then publish a rate card so Lufer.ai search can price it for corporate buyers." : "An Owner or Manager adds this partner's venues."}
                  action={
                    canAddListing ? (
                      <Link href="#add-listing" className="btn btn-secondary h-8 px-3 text-meta">
                        <Plus className="size-3.5" aria-hidden /> Add listing
                      </Link>
                    ) : null
                  }
                />
              ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Venue</TableHead>
                    <TableHead className="text-right">Capacity</TableHead>
                    <TableHead className="text-right">Min spend</TableHead>
                    <TableHead className="text-right">From / head</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.map((l) => {
                    const from = fromPerHead(rates, l.id, today);
                    return (
                      // The name's link stretches over the row (after:inset-0); controls sit above it (relative z-10).
                      <TableRow key={l.id} className="relative cursor-pointer">
                        <TableCell>
                          <Link
                            href={listingHref(l.id)}
                            className="font-medium after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                          >
                            {l.name}
                            <span className="sr-only">: open its rate cards</span>
                          </Link>
                          <div className="text-fg-subtle text-caption">
                            <span className="font-mono">{l.ref}</span> · {l.area}, {l.city}
                            {l.private_dining ? " · private dining" : ""}
                          </div>
                          {can.has("listing.edit") ? (
                            <details className="relative z-10 mt-2">
                              <summary className="text-fg cursor-pointer text-caption hover:underline">Edit details</summary>
                              <div className="mt-3">
                                <ListingForm
                                  partnerId={formPartnerId}
                                  listing={{ ...l, min_spend_inr: Number(l.min_spend_inr) }}
                                />
                              </div>
                            </details>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.capacity}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(Number(l.min_spend_inr))}</TableCell>
                        <TableCell className="text-right tabular-nums">{from != null ? formatINR(from) : <span className="text-fg-faint">no rate</span>}</TableCell>
                        <TableCell>
                          <Badge variant={l.status === "active" ? "success" : "secondary"}>{l.status}</Badge>
                        </TableCell>
                        <TableCell className="relative z-10 text-right">
                          <div className="flex justify-end gap-1.5">
                            {can.has("listing.status") ? <ListingStatusButton partnerId={formPartnerId} id={l.id} status={l.status} /> : null}
                            {can.has("listing.edit") ? <DeleteListingButton partnerId={formPartnerId} id={l.id} name={l.name} /> : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              )}
            </CardContent>
          </Card>

          {canAddListing ? (
            <Card id="add-listing" className="scroll-mt-20">
              <CardHeader>
                <CardTitle>Add a listing</CardTitle>
                <CardDescription>Publish a venue to Lufer.ai corporate buyers. After adding it you&apos;ll set its first rate, so search can price it.</CardDescription>
              </CardHeader>
              <CardContent>
                <ListingForm partnerId={formPartnerId} ratesHref={href("rates")} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeTab === "rates" ? (
        <div className="space-y-6">
          {selected ? (
            <>
              <Link href={href("rates")} className="text-fg-subtle hover:text-fg inline-flex items-center gap-1.5 text-meta">
                <ArrowLeft className="size-3.5" aria-hidden /> All rate cards
              </Link>
              {justCreated ? (
                <section role="status" aria-label="Listing added" className="border-sage/30 bg-sage/[0.06] flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border px-5 py-4">
                  <CheckCircle2 className="text-sage size-5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-fg text-body font-medium">{selected.name} is live</p>
                    <p className="text-fg-subtle text-meta">Publish its first rate card so Lufer.ai search can price it for corporate buyers.</p>
                  </div>
                  {can.has("rates.edit") ? (
                    <Link href="#rate-form" className="btn btn-secondary h-8 px-3 text-meta">
                      <Tag className="size-3.5" aria-hidden /> Create rate card
                    </Link>
                  ) : null}
                </section>
              ) : null}
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {selected.name} <Badge variant={selected.status === "active" ? "success" : "secondary"}>{selected.status}</Badge>
                    </CardTitle>
                    <CardDescription>
                      <span className="font-mono">{selected.ref}</span> · {selected.area}, {selected.city} · up to {selected.capacity} guests · min spend{" "}
                      {formatINR(Number(selected.min_spend_inr))}
                      {selected.private_dining ? " · private dining" : ""}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1.5">
                    {can.has("listing.status") ? <ListingStatusButton partnerId={formPartnerId} id={selected.id} status={selected.status} /> : null}
                  </div>
                </CardHeader>
                {can.has("listing.edit") ? (
                  <CardContent>
                    <details>
                      <summary className="text-fg cursor-pointer text-meta hover:underline">Edit details</summary>
                      <div className="mt-3">
                        <ListingForm partnerId={formPartnerId} listing={{ ...selected, min_spend_inr: Number(selected.min_spend_inr) }} />
                      </div>
                    </details>
                  </CardContent>
                ) : null}
              </Card>
            </>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{selected ? `Rate cards · ${selected.name}` : "Rate cards"}</CardTitle>
              <CardDescription>
                Per-head prices (pre-GST) by listing, date range and group size. Within one group bracket, rates can&apos;t overlap.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {shownRates.length === 0 ? (
                <EmptyState
                  compact
                  icon={Tag}
                  title={listings.length === 0 ? "Add a listing first" : selected ? `No rates for ${selected.name} yet` : "No rate cards yet"}
                  description={
                    listings.length === 0
                      ? "Rate cards price a listing. Add a venue, then publish its per-head rates here."
                      : "Without a rate, search can't show a price for this venue. Publish a per-head rate for a date range and group size."
                  }
                  action={
                    listings.length === 0 ? (
                      canAddListing ? (
                        <Link href={`${href("listings")}#add-listing`} className="btn btn-secondary h-8 px-3 text-meta">
                          <Plus className="size-3.5" aria-hidden /> Add listing
                        </Link>
                      ) : null
                    ) : can.has("rates.edit") ? (
                      <Link href="#rate-form" className="btn btn-secondary h-8 px-3 text-meta">
                        <Tag className="size-3.5" aria-hidden /> Publish a rate
                      </Link>
                    ) : null
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {selected ? null : <TableHead>Listing</TableHead>}
                      <TableHead>Rate</TableHead>
                      <TableHead className="text-right">Per head</TableHead>
                      <TableHead className="text-right">Guests</TableHead>
                      <TableHead>Valid</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownRates.map((r) => {
                      const state = isRateActiveOn(r, today) ? "in effect" : r.valid_from > today ? "upcoming" : "ended";
                      return (
                        <TableRow key={r.id} className={state === "ended" ? "opacity-60" : undefined}>
                          {selected ? null : (
                            <TableCell className="font-medium">
                              <Link href={listingHref(r.partner_venue_id)} className="hover:underline">
                                {listingName.get(r.partner_venue_id) ?? "—"}
                              </Link>
                            </TableCell>
                          )}
                          <TableCell>{r.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatINR(r.per_head_inr)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.min_guests}+</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-meta tabular-nums">
                                {formatDate(r.valid_from)} – {r.valid_to ? formatDate(r.valid_to) : "open-ended"}
                              </span>
                              <Badge variant={state === "in effect" ? "success" : state === "upcoming" ? "warning" : "outline"}>{state}</Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {can.has("rates.edit") ? <DeleteRateButton partnerId={formPartnerId} id={r.id} label={r.label} /> : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {can.has("rates.edit") && listings.length > 0 ? (
            <Card id="rate-form" className="scroll-mt-20">
              <CardHeader>
                <CardTitle>{selected ? `Publish a rate for ${selected.name}` : "Publish a rate"}</CardTitle>
                <CardDescription>To change a price, end the current rate (or delete it) and publish the new one from the next day.</CardDescription>
              </CardHeader>
              <CardContent>
                <RateCardForm
                  key={selected?.id ?? "all"}
                  partnerId={formPartnerId}
                  listings={listings.map((l) => ({ id: l.id, name: l.name }))}
                  minDate={today}
                  defaultListingId={selected?.id}
                  autoFocus={justCreated}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeTab === "catalog" ? (
        <PartnerCatalog
          partnerId={formPartnerId}
          gstin={partner.gstin}
          items={catalogItems}
          canEdit={can.has("catalog.edit")}
          canStatus={can.has("listing.status")}
          canSetGstin={can.has("team.manage")}
        />
      ) : null}

      {activeTab === "orders" ? <LowStock partnerId={formPartnerId} items={catalogItems} canEdit={can.has("catalog.edit")} /> : null}

      {activeTab === "orders" ? (
        <PartnerOrders
          partnerId={formPartnerId}
          canFulfil={can.has("orders.fulfil")}
          today={today}
          catalogHref={visibleTabs.some((t) => t.key === "catalog") ? href("catalog") : undefined}
          orders={orders.map((o) => ({
            id: o.id,
            company_name: o.company_name,
            item_name: o.item_name,
            category: o.category,
            quantity: o.quantity,
            total_amount_inr: o.total_amount_inr,
            status: o.status,
            event_date: o.event_date,
            needed_by: o.needed_by,
            selections: (o.selections ?? {}) as Record<string, unknown>,
            recipients: (Array.isArray(o.recipients) ? o.recipients : []) as FulfilOrder["recipients"],
            tracking: o.tracking as FulfilOrder["tracking"],
            ...(settlements.has(o.id) && {
              settlement: {
                stage: settlements.get(o.id)!.stage,
                net: settlements.get(o.id)!.payout ? Number(settlements.get(o.id)!.payout!.net_payout_inr) : null,
                issues: settlements.get(o.id)!.issues,
              },
            }),
          }))}
        />
      ) : null}

      {activeTab === "payouts" ? (
        <PartnerPayouts
          partner={partner}
          isAdmin={isAdmin}
          enabled={orderPaymentsEnabled()}
          rows={orders.flatMap((o) => {
            const st = settlements.get(o.id);
            return st?.payout ? [{ orderId: o.id, label: `${o.quantity} × ${o.item_name}`, company: o.company_name, payout: st.payout, issues: st.issues }] : [];
          })}
          tcs={tcs}
          ordersHref={href("orders")}
        />
      ) : null}

      {activeTab === "team" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
              <CardDescription>Owners manage the team; Managers edit listings and rates; Staff can view and pause listings.</CardDescription>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <EmptyState
                  compact
                  icon={Users}
                  title="No team members yet"
                  description="Invite this partner's first Owner. Owners then invite Managers to edit listings and rates, and Staff to pause listings."
                  action={
                    <Link href="#invite" className="btn btn-secondary h-8 px-3 text-meta">
                      <Plus className="size-3.5" aria-hidden /> Invite the first Owner
                    </Link>
                  }
                />
              ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell>
                        {m.email}
                        {m.userId === member.userId ? <span className="text-fg-subtle ml-1.5 text-caption">(you)</span> : null}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatDate(m.joinedAt.slice(0, 10))}</TableCell>
                      <TableCell>
                        <MemberRoleForm partnerId={formPartnerId} userId={m.userId} role={m.partnerRole} email={m.email} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
            </CardContent>
          </Card>
          <Card id="invite" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Invite someone</CardTitle>
              <CardDescription>New addresses get a sign-in invitation; existing Lufer.ai users without another organisation are added directly.</CardDescription>
            </CardHeader>
            <CardContent>
              <InviteForm partnerId={formPartnerId} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "activity" ? (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>The last 50 changes to listings, rates and the team.</CardDescription>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <EmptyState
                compact
                icon={History}
                title="No changes yet"
                description="Every change to listings, rates and the team is recorded here with who made it."
                action={
                  <Link href={href("listings")} className="btn btn-secondary h-8 px-3 text-meta">
                    <Store className="size-3.5" aria-hidden /> Go to Listings
                  </Link>
                }
              />
            ) : (
              <ol className="divide-line divide-y">
                {audit.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-meta">
                    <time className="text-fg-subtle w-28 shrink-0 font-mono text-caption">{CLOCK.format(new Date(a.created_at))}</time>
                    <span className="text-fg font-mono text-caption">{a.action}</span>
                    <span className="text-fg-muted min-w-0 flex-1 truncate">{describe(a.detail)}</span>
                    <span className="text-fg-subtle text-caption">{a.actor}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      ) : null}
    </PortalShell>
  );
}

/** One-line summary of an audit entry's detail. */
function describe(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const d = detail as Record<string, unknown>;
  const name = d.name ?? d.label ?? d.email;
  const parts = [name ? String(name) : null];
  if (typeof d.per_head_inr === "number") parts.push(`${formatINR(d.per_head_inr)}/head`);
  if (d.from && d.to) parts.push(`${String(d.from).toLowerCase()} → ${String(d.to).toLowerCase()}`);
  if (d.partner_role) parts.push(String(d.partner_role).toLowerCase());
  return parts.filter(Boolean).join(" · ");
}
