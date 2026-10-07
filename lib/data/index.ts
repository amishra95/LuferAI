import "server-only";

import { calculateGst, roundInr, splitCommission, sumInr, type TaxInvoicePayload } from "@/lib/gst-engine";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import type {
  ApprovalChain,
  ApprovalComment,
  ApprovalStatus,
  Booking,
  BookingApproval,
  BookingStatus,
  Company,
  CorporatePolicy,
  CorporateRateCard,
  CorporateRole,
  ExpenseExport,
  InventoryHold,
  Venue,
  VenueOnboardingRequest,
} from "@/lib/supabase/database.types";
import { isRateCardActive } from "@/lib/rates/apply-rate-card";
import type { Json } from "@/lib/supabase/database.generated";
import { mockDb, mockGstType } from "./mock-store";

/**
 * Single data-access layer for all three portals.
 * - Supabase mode: when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
 * - Mock mode: otherwise, backed by an in-memory copy of supabase/seed.sql.
 * Tax, commission and payout figures are always computed via lib/gst-engine.ts
 * so the UI and invoices share one source of truth.
 */

export type DataSource = "supabase" | "mock";
export const dataSource = (): DataSource => (isSupabaseConfigured() ? "supabase" : "mock");

export interface BookingDetail extends Booking {
  company: Pick<Company, "id" | "legal_name" | "gstin" | "state_code">;
  venue: Pick<Venue, "id" | "name" | "neighborhood" | "city" | "gstin" | "commission_rate">;
  invoice: TaxInvoicePayload;
  commission_inr: number;
  venue_payout_inr: number;
}

function enrich(
  b: Booking,
  company: BookingDetail["company"],
  venue: BookingDetail["venue"]
): BookingDetail {
  const total = Number(b.total_amount_inr);
  const invoice = calculateGst({
    total_amount: total,
    // Invoices go to the GSTIN being billed (a branch registration may differ from the company's main one).
    company_gstin: b.billing_gstin ?? company.gstin,
    venue_gstin: venue.gstin,
    booking_id: b.id,
    invoice_date: b.event_date,
  });
  // The rate snapshotted on the booking, not the venue's current rate, so later
  // rate changes never rewrite historical commission or payouts.
  const split = splitCommission(total, Number(b.commission_rate));
  return {
    ...b,
    total_amount_inr: total,
    budget_per_head_inr: Number(b.budget_per_head_inr),
    commission_rate: split.commission_rate,
    company,
    venue: { ...venue, commission_rate: Number(venue.commission_rate) },
    invoice,
    commission_inr: split.commission,
    venue_payout_inr: split.venue_payout,
  };
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function listCompanies(): Promise<Company[]> {
  if (dataSource() === "mock") return [...mockDb.companies];
  const { data, error } = await createAdminClient().from("companies").select("*").order("legal_name");
  if (error) throw error;
  return data;
}

export async function listVenues(): Promise<Venue[]> {
  if (dataSource() === "mock") return mockDb.venues.filter((v) => v.is_active);
  const { data, error } = await createAdminClient()
    .from("venues")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data;
}

export async function listBookings(filter: { companyId?: string; venueId?: string } = {}): Promise<BookingDetail[]> {
  if (dataSource() === "mock") {
    return mockDb.bookings
      .filter((b) => (!filter.companyId || b.company_id === filter.companyId) && (!filter.venueId || b.venue_id === filter.venueId))
      // Venues never see bookings still awaiting the company's internal sign-off.
      .filter((b) => !filter.venueId || b.status !== "PENDING_APPROVAL")
      .sort((a, b) => b.event_date.localeCompare(a.event_date))
      .map((b) => {
        const c = mockDb.companies.find((x) => x.id === b.company_id)!;
        const v = mockDb.venues.find((x) => x.id === b.venue_id)!;
        return enrich(b, c, v);
      });
  }

  let query = createAdminClient()
    .from("bookings")
    .select(
      "*, company:companies(id, legal_name, gstin, state_code), venue:venues(id, name, neighborhood, city, gstin, commission_rate)"
    )
    .order("event_date", { ascending: false });
  if (filter.companyId) query = query.eq("company_id", filter.companyId);
  if (filter.venueId) query = query.eq("venue_id", filter.venueId).neq("status", "PENDING_APPROVAL");

  const { data, error } = await query;
  if (error) throw error;
  type Row = Booking & { company: BookingDetail["company"]; venue: BookingDetail["venue"] };
  return (data as unknown as Row[]).map(({ company, venue, ...b }) => enrich(b, company, venue));
}

export async function listOnboardingRequests(): Promise<VenueOnboardingRequest[]> {
  if (dataSource() === "mock") {
    return mockDb.onboarding
      .filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW")
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }
  const { data, error } = await createAdminClient()
    .from("venue_onboarding_requests")
    .select("*")
    .in("status", ["SUBMITTED", "UNDER_REVIEW"])
    .order("submitted_at", { ascending: false });
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------------------
// Aggregates
// ----------------------------------------------------------------------------

export interface PlatformMetrics {
  totalBookings: number;
  pendingBookings: number;
  grossBookingValue: number; // all non-cancelled, pre-GST
  commissionEarned: number; // CONFIRMED + COMPLETED
  gstCollected: number; // non-cancelled
}

export function computePlatformMetrics(bookings: BookingDetail[]): PlatformMetrics {
  const live = bookings.filter((b) => b.status !== "CANCELLED");
  const earned = bookings.filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED");
  return {
    totalBookings: bookings.length,
    pendingBookings: bookings.filter((b) => b.status === "PENDING").length,
    grossBookingValue: sumInr(live.map((b) => b.total_amount_inr)),
    commissionEarned: sumInr(earned.map((b) => b.commission_inr)),
    gstCollected: sumInr(live.map((b) => b.invoice.total_tax)),
  };
}

export interface ItcSummary {
  reclaimed: number; // GST on COMPLETED (invoiced) bookings
  pipeline: number; // GST on PENDING + CONFIRMED
  committedSpend: number;
}

export function computeItcSummary(bookings: BookingDetail[]): ItcSummary {
  const sum = (xs: BookingDetail[], f: (b: BookingDetail) => number) => sumInr(xs.map(f));
  return {
    reclaimed: sum(bookings.filter((b) => b.status === "COMPLETED"), (b) => b.invoice.total_tax),
    pipeline: sum(bookings.filter((b) => b.status === "PENDING" || b.status === "CONFIRMED"), (b) => b.invoice.total_tax),
    committedSpend: sum(bookings.filter((b) => b.status !== "CANCELLED"), (b) => b.total_amount_inr),
  };
}

export interface MonthlyPayout {
  month: string; // YYYY-MM
  bookings: number;
  taxableValue: number;
  commission: number;
  payout: number;
  settled: boolean;
}

export function computeMonthlyPayouts(bookings: BookingDetail[]): MonthlyPayout[] {
  const byMonth = new Map<string, MonthlyPayout>();
  for (const b of bookings) {
    if (b.status !== "CONFIRMED" && b.status !== "COMPLETED") continue;
    const month = b.event_date.slice(0, 7);
    const row = byMonth.get(month) ?? { month, bookings: 0, taxableValue: 0, commission: 0, payout: 0, settled: true };
    row.bookings += 1;
    row.taxableValue = sumInr([row.taxableValue, b.total_amount_inr]);
    row.commission = sumInr([row.commission, b.commission_inr]);
    row.payout = sumInr([row.payout, b.venue_payout_inr]);
    row.settled &&= b.status === "COMPLETED";
    byMonth.set(month, row);
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

// ----------------------------------------------------------------------------
// Writes
// ----------------------------------------------------------------------------

export interface NewBookingInput {
  company_id: string;
  venue_id: string;
  party_size: number;
  budget_per_head_inr: number;
  event_date: string;
  notes?: string;
  /** Expense metadata for finance: required cost centre, optional project, billing GSTIN (defaults to the company's). */
  cost_center: string;
  project_code?: string | null;
  billing_gstin?: string | null;
  department_id?: string | null;
  /** Per-head before the corporate rate card; omit when list pricing applied. */
  list_budget_per_head_inr?: number | null;
  /** corporate_rate_cards row used to price the booking, if any. */
  rate_card_id?: string | null;
}

export interface NewApprovalRequest {
  requested_by: string;
  approver_id: string;
  /** Why the policy requires sign-off. */
  reason: string;
}

/** Thrown when another live hold already locks the venue on the event date. */
export class HoldConflictError extends Error {
  constructor(venueName: string, date: string) {
    super(`${venueName} was just held for ${date} by another booking. Pick another date.`);
    this.name = "HoldConflictError";
  }
}

export interface NewHoldRequest {
  hold_start: string;
  hold_expires_at: string;
}

/**
 * Creates a booking. With `approvals`, the booking starts as PENDING_APPROVAL and
 * one booking_approvals row is raised per approver (tier 1, plus tier 2 for
 * high-value bookings); it reaches the venue once all are approved. Otherwise it
 * goes straight to the venue as PENDING. With `hold`, an ACTIVE inventory hold locks the venue
 * on the event date; if the date is already held the whole booking is refused.
 */
export async function createBookingRequest(
  input: NewBookingInput,
  options: { approvals?: NewApprovalRequest[]; hold?: NewHoldRequest } = {}
): Promise<BookingDetail> {
  const { hold } = options;
  const approvals = options.approvals ?? [];
  const total = roundInr(input.party_size * input.budget_per_head_inr);
  const status: BookingStatus = approvals.length ? "PENDING_APPROVAL" : "PENDING";
  const row = {
    ...input,
    notes: input.notes ?? null,
    project_code: input.project_code ?? null,
    billing_gstin: input.billing_gstin ?? null,
    department_id: input.department_id ?? null,
    list_budget_per_head_inr: input.list_budget_per_head_inr ?? null,
    rate_card_id: input.rate_card_id ?? null,
  };

  if (dataSource() === "mock") {
    const c = mockDb.companies.find((x) => x.id === input.company_id);
    const v = mockDb.venues.find((x) => x.id === input.venue_id);
    if (!c || !v) throw new Error("Unknown company or venue");
    const now = new Date().toISOString();
    // Mock equivalent of the inventory_holds_before_insert conflict check.
    if (hold && mockDb.holds.some((h) => h.venue_id === v.id && h.status === "ACTIVE" && h.hold_expires_at > now &&
        mockDb.bookings.find((b) => b.id === h.booking_id)?.event_date === input.event_date)) {
      throw new HoldConflictError(v.name, input.event_date);
    }
    const booking: Booking = {
      id: crypto.randomUUID(),
      ...row,
      total_amount_inr: total,
      sac_code: "998596",
      gst_type: mockGstType(input.company_id, input.venue_id, row.billing_gstin),
      // Mock equivalent of the bookings_snapshot_commission_rate trigger.
      commission_rate: v.commission_rate,
      status,
      created_at: now,
      updated_at: now,
    };
    mockDb.bookings.push(booking);
    for (const approval of approvals) {
      mockDb.approvals.push({
        id: crypto.randomUUID(),
        tenant_id: input.company_id,
        booking_id: booking.id,
        ...approval,
        status: "PENDING",
        decision_note: null,
        decided_at: null,
        created_at: now,
        updated_at: now,
      });
    }
    if (hold) {
      mockDb.holds.push({
        id: crypto.randomUUID(),
        venue_id: v.id,
        tenant_id: c.id,
        booking_id: booking.id,
        ...hold,
        status: "ACTIVE",
        created_at: now,
        updated_at: now,
      });
    }
    return enrich(booking, c, v);
  }

  // commission_rate is snapshotted from the venue by the bookings_snapshot_commission_rate trigger.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .insert({ ...row, total_amount_inr: total, status })
    .select("id")
    .single();
  if (error) throw error;

  // No multi-statement transactions over PostgREST: if a dependent row fails,
  // delete the booking (approvals and holds cascade) so nothing is left half-made.
  const undo = () => supabase.from("bookings").delete().eq("id", data.id);
  if (approvals.length) {
    const { error: approvalError } = await supabase
      .from("booking_approvals")
      .insert(approvals.map((a) => ({ tenant_id: input.company_id, booking_id: data.id, ...a })));
    if (approvalError) {
      await undo();
      throw approvalError;
    }
  }
  if (hold) {
    const { error: holdError } = await supabase
      .from("inventory_holds")
      .insert({ venue_id: input.venue_id, tenant_id: input.company_id, booking_id: data.id, ...hold });
    if (holdError) {
      await undo();
      // 23P01: inventory_holds_before_insert found a live hold on this venue/date.
      if (holdError.code === "23P01") {
        const venue = (await listVenues()).find((v) => v.id === input.venue_id);
        throw new HoldConflictError(venue?.name ?? "This venue", input.event_date);
      }
      throw holdError;
    }
  }
  const [created] = (await listBookings()).filter((b) => b.id === data.id);
  return created;
}

/** Mock equivalent of the bookings_sync_inventory_holds trigger. */
function mockSyncHolds(bookingId: string, status: BookingStatus) {
  if (status !== "CONFIRMED" && status !== "CANCELLED") return;
  const now = new Date().toISOString();
  for (const h of mockDb.holds) {
    if (h.booking_id === bookingId && h.status === "ACTIVE") {
      h.status = status === "CONFIRMED" ? "CONVERTED" : "RELEASED";
      h.updated_at = now;
    }
  }
}

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING_APPROVAL: ["PENDING", "CANCELLED"],
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function updateBookingStatus(id: string, next: BookingStatus, scope: { venueId?: string } = {}) {
  if (dataSource() === "mock") {
    const b = mockDb.bookings.find((x) => x.id === id && (!scope.venueId || x.venue_id === scope.venueId));
    if (!b) throw new Error("Booking not found");
    if (!ALLOWED_TRANSITIONS[b.status].includes(next)) {
      throw new Error(`Cannot move a ${b.status} booking to ${next}`);
    }
    b.status = next;
    b.updated_at = new Date().toISOString();
    mockSyncHolds(b.id, next);
    return;
  }

  // The DB trigger bookings_guard_status_transition enforces the same rules, and
  // bookings_sync_inventory_holds converts/releases the booking's live hold.
  let query = createAdminClient().from("bookings").update({ status: next }).eq("id", id);
  if (scope.venueId) query = query.eq("venue_id", scope.venueId);
  // Zero rows means another venue's booking (or a missing one): fail loudly rather
  // than let the caller capture a deposit for a booking it didn't change.
  const { data, error } = await query.select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("Booking not found");
}

// ----------------------------------------------------------------------------
// Corporate approval workflows
// ----------------------------------------------------------------------------

export interface PortalUser {
  id: string;
  companyId: string | null;
  name: string;
  /** Organizer requests events, Approver signs off, Finance viewer is read-only. */
  role: CorporateRole | null;
}

/** Client-portal users (platform_users with role CLIENT), optionally for one tenant. */
export async function listPortalUsers(filter: { companyId?: string } = {}): Promise<PortalUser[]> {
  if (dataSource() === "mock") {
    return mockDb.users
      .filter((u) => !filter.companyId || u.company_id === filter.companyId)
      .map((u) => ({ id: u.user_id, companyId: u.company_id, name: u.name, role: u.corporate_role }));
  }

  const supabase = createAdminClient();
  let query = supabase.from("platform_users").select("user_id, company_id, corporate_role").eq("role", "CLIENT");
  if (filter.companyId) query = query.eq("company_id", filter.companyId);
  // platform_users has no name column; label people by their auth email.
  const [{ data, error }, auth] = await Promise.all([query, supabase.auth.admin.listUsers({ perPage: 1000 })]);
  if (error) throw error;
  if (auth.error) throw auth.error;
  const emails = new Map(auth.data.users.map((u) => [u.id, u.email ?? u.id]));
  return data
    .map((u) => ({ id: u.user_id, companyId: u.company_id, name: emails.get(u.user_id) ?? u.user_id, role: u.corporate_role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCorporatePolicy(tenantId: string): Promise<CorporatePolicy | null> {
  if (dataSource() === "mock") return mockDb.policies.find((p) => p.tenant_id === tenantId) ?? null;
  const { data, error } = await createAdminClient()
    .from("corporate_policies")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return (
    data && {
      ...data,
      max_budget_per_head: numOrNull(data.max_budget_per_head),
      requires_approval_above: numOrNull(data.requires_approval_above),
      high_value_threshold: numOrNull(data.high_value_threshold),
    }
  );
}

const numOrNull = (v: number | string | null) => (v === null ? null : Number(v));

/** The tenant's approvers, lowest tier first. */
export async function listApprovalChain(tenantId: string): Promise<ApprovalChain[]> {
  if (dataSource() === "mock") {
    return mockDb.approvalChains.filter((c) => c.tenant_id === tenantId).sort((a, b) => a.tier_level - b.tier_level);
  }
  const { data, error } = await createAdminClient()
    .from("approval_chains")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("tier_level");
  if (error) throw error;
  return data;
}

/** Approver → tier, keyed "tenantId:userId" (optionally for one tenant). */
async function approverTiers(tenantId?: string): Promise<Map<string, number>> {
  let rows: ApprovalChain[];
  if (dataSource() === "mock") {
    rows = mockDb.approvalChains.filter((c) => !tenantId || c.tenant_id === tenantId);
  } else {
    let q = createAdminClient().from("approval_chains").select("*");
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q;
    if (error) throw error;
    rows = data;
  }
  return new Map(rows.map((c) => [`${c.tenant_id}:${c.approver_user_id}`, c.tier_level]));
}

export interface ApprovalDetail extends BookingApproval {
  company: Pick<Company, "id" | "legal_name">;
  booking: Pick<Booking, "id" | "event_date" | "party_size" | "budget_per_head_inr" | "total_amount_inr" | "status"> & {
    venue_name: string;
  };
  requester_name: string;
  approver_name: string;
  /** The approver's tier in the tenant's chain (1 = manager, 2 = senior sign-off). */
  tier: number | null;
}

export async function listApprovals(
  filter: { tenantId?: string; approverId?: string; status?: ApprovalStatus } = {}
): Promise<ApprovalDetail[]> {
  const users = new Map((await listPortalUsers()).map((u) => [u.id, u.name]));
  const tiers = await approverTiers(filter.tenantId);
  const named = (a: Omit<ApprovalDetail, "requester_name" | "approver_name" | "tier">): ApprovalDetail => ({
    ...a,
    requester_name: users.get(a.requested_by) ?? "Unknown user",
    approver_name: users.get(a.approver_id) ?? "Unknown user",
    tier: tiers.get(`${a.tenant_id}:${a.approver_id}`) ?? null,
  });

  if (dataSource() === "mock") {
    return mockDb.approvals
      .filter(
        (a) =>
          (!filter.tenantId || a.tenant_id === filter.tenantId) &&
          (!filter.approverId || a.approver_id === filter.approverId) &&
          (!filter.status || a.status === filter.status)
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((a) => {
        const c = mockDb.companies.find((x) => x.id === a.tenant_id)!;
        const b = mockDb.bookings.find((x) => x.id === a.booking_id)!;
        const v = mockDb.venues.find((x) => x.id === b.venue_id)!;
        const { id, event_date, party_size, budget_per_head_inr, total_amount_inr, status } = b;
        return named({
          ...a,
          company: { id: c.id, legal_name: c.legal_name },
          booking: { id, event_date, party_size, budget_per_head_inr, total_amount_inr, status, venue_name: v.name },
        });
      });
  }

  let query = createAdminClient()
    .from("booking_approvals")
    .select(
      "*, company:companies(id, legal_name), booking:bookings(id, event_date, party_size, budget_per_head_inr, total_amount_inr, status, venue:venues(name))"
    )
    .order("created_at", { ascending: false });
  if (filter.tenantId) query = query.eq("tenant_id", filter.tenantId);
  if (filter.approverId) query = query.eq("approver_id", filter.approverId);
  if (filter.status) query = query.eq("status", filter.status);

  const { data, error } = await query;
  if (error) throw error;
  type Row = BookingApproval & {
    company: ApprovalDetail["company"];
    booking: Omit<ApprovalDetail["booking"], "venue_name"> & { venue: { name: string } };
  };
  return (data as unknown as Row[]).map(({ booking: { venue, ...b }, ...a }) =>
    named({
      ...a,
      booking: {
        ...b,
        budget_per_head_inr: Number(b.budget_per_head_inr),
        total_amount_inr: Number(b.total_amount_inr),
        venue_name: venue.name,
      },
    })
  );
}

/**
 * Records the approver's decision. Only the assigned approver, within their own
 * tenant, can decide, and only while PENDING. In Supabase the
 * booking_approvals_apply_decision trigger then moves the booking; the mock
 * branch mirrors it.
 */
export async function decideApproval(
  id: string,
  scope: { approverId: string; tenantId: string },
  decision: Exclude<ApprovalStatus, "PENDING">,
  note?: string
) {
  // Sign-off is sequential: a tier-2 approver decides only after every lower tier has approved.
  if (decision === "APPROVED") await assertLowerTiersApproved(id, scope.tenantId);

  if (dataSource() === "mock") {
    const a = mockDb.approvals.find(
      (x) => x.id === id && x.approver_id === scope.approverId && x.tenant_id === scope.tenantId && x.status === "PENDING"
    );
    if (!a) throw new Error("This approval was not found or has already been decided.");
    const now = new Date().toISOString();
    Object.assign(a, { status: decision, decision_note: note ?? null, decided_at: now, updated_at: now });

    const booking = mockDb.bookings.find((b) => b.id === a.booking_id);
    const othersOpen = mockDb.approvals.some((x) => x.booking_id === a.booking_id && x.id !== a.id && x.status !== "APPROVED");
    if (booking?.status === "PENDING_APPROVAL" && (decision === "REJECTED" || !othersOpen)) {
      booking.status = decision === "REJECTED" ? "CANCELLED" : "PENDING";
      booking.updated_at = now;
      mockSyncHolds(booking.id, booking.status);
    }
    return;
  }

  const { data, error } = await createAdminClient()
    .from("booking_approvals")
    .update({ status: decision, decision_note: note ?? null })
    .eq("id", id)
    .eq("approver_id", scope.approverId)
    .eq("tenant_id", scope.tenantId)
    .eq("status", "PENDING")
    .select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("This approval was not found or has already been decided.");
}

async function approvalsForBookingOf(approvalId: string, tenantId: string): Promise<BookingApproval[]> {
  if (dataSource() === "mock") {
    const a = mockDb.approvals.find((x) => x.id === approvalId && x.tenant_id === tenantId);
    return a ? mockDb.approvals.filter((x) => x.booking_id === a.booking_id) : [];
  }
  const db = createAdminClient();
  const { data: a, error } = await db.from("booking_approvals").select("booking_id").eq("id", approvalId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!a) return [];
  const { data, error: e2 } = await db.from("booking_approvals").select("*").eq("booking_id", a.booking_id);
  if (e2) throw e2;
  return data;
}

async function assertLowerTiersApproved(approvalId: string, tenantId: string) {
  const [siblings, tiers, users] = await Promise.all([approvalsForBookingOf(approvalId, tenantId), approverTiers(tenantId), listPortalUsers({ companyId: tenantId })]);
  const me = siblings.find((x) => x.id === approvalId);
  if (!me) return; // decideApproval reports "not found"
  const myTier = tiers.get(`${tenantId}:${me.approver_id}`) ?? 1;
  const waitingOn = siblings.find((x) => x.id !== approvalId && x.status === "PENDING" && (tiers.get(`${tenantId}:${x.approver_id}`) ?? 1) < myTier);
  if (waitingOn) {
    const name = users.find((u) => u.id === waitingOn.approver_id)?.name ?? "the previous approver";
    throw new Error(`Waiting for tier-${tiers.get(`${tenantId}:${waitingOn.approver_id}`) ?? 1} sign-off from ${name} first.`);
  }
}

// ----------------------------------------------------------------------------
// Approval threads
// ----------------------------------------------------------------------------

export interface ApprovalCommentDetail extends ApprovalComment {
  author_name: string;
}

/** Comments on the given approvals, oldest first, with author names. */
export async function listApprovalComments(approvalIds: string[], tenantId: string): Promise<ApprovalCommentDetail[]> {
  if (approvalIds.length === 0) return [];
  const names = new Map((await listPortalUsers({ companyId: tenantId })).map((u) => [u.id, u.name]));
  let rows: ApprovalComment[];
  if (dataSource() === "mock") {
    rows = mockDb.approvalComments.filter((c) => c.tenant_id === tenantId && approvalIds.includes(c.approval_id));
  } else {
    const { data, error } = await createAdminClient()
      .from("approval_comments")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("approval_id", approvalIds);
    if (error) throw error;
    rows = data;
  }
  return rows
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => ({ ...c, author_name: names.get(c.author_id) ?? "Unknown user" }));
}

/** Adds a comment; the approval and the author must both belong to the tenant. */
export async function addApprovalComment(input: { approvalId: string; tenantId: string; authorId: string; body: string }) {
  const body = input.body.trim();
  if (!body || body.length > 2000) throw new Error("Comments are 1–2000 characters.");
  if (dataSource() === "mock") {
    if (!mockDb.approvals.some((a) => a.id === input.approvalId && a.tenant_id === input.tenantId)) throw new Error("Approval not found.");
    if (!mockDb.users.some((u) => u.user_id === input.authorId && u.company_id === input.tenantId)) throw new Error("Unknown author.");
    mockDb.approvalComments.push({
      id: crypto.randomUUID(),
      approval_id: input.approvalId,
      tenant_id: input.tenantId,
      author_id: input.authorId,
      body,
      created_at: new Date().toISOString(),
    });
    return;
  }
  // The approval_comments_author_fkey (author, tenant) FK enforces membership in Postgres.
  const db = createAdminClient();
  const { data: approval, error: e1 } = await db.from("booking_approvals").select("id").eq("id", input.approvalId).eq("tenant_id", input.tenantId).maybeSingle();
  if (e1) throw e1;
  if (!approval) throw new Error("Approval not found.");
  const { error } = await db
    .from("approval_comments")
    .insert({ approval_id: input.approvalId, tenant_id: input.tenantId, author_id: input.authorId, body });
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Expense exports (finance sync audit log)
// ----------------------------------------------------------------------------

export type ExpenseExportEvent = "booking.confirmed";
export type NewExpenseExport = Omit<ExpenseExport, "id" | "created_at" | "receipt"> & { receipt: Json };

/** The existing export for a booking/event, if any (exports are idempotent per booking + event). */
export async function findExpenseExport(bookingId: string, event: ExpenseExportEvent): Promise<ExpenseExport | null> {
  if (dataSource() === "mock") return mockDb.expenseExports.find((e) => e.booking_id === bookingId && e.event === event) ?? null;
  const { data, error } = await createAdminClient().from("expense_exports").select("*").eq("booking_id", bookingId).eq("event", event).maybeSingle();
  if (error) throw error;
  return data;
}

/** Records an export. Returns false if one already exists for this booking + event. */
export async function recordExpenseExport(row: NewExpenseExport): Promise<boolean> {
  if (dataSource() === "mock") {
    if (mockDb.expenseExports.some((e) => e.booking_id === row.booking_id && e.event === row.event)) return false;
    mockDb.expenseExports.push({ ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() });
    return true;
  }
  const { error } = await createAdminClient().from("expense_exports").insert(row);
  if (error?.code === "23505") return false; // unique (booking_id, event)
  if (error) throw error;
  return true;
}

export async function listExpenseExports(filter: { tenantId?: string; limit?: number } = {}): Promise<ExpenseExport[]> {
  const limit = filter.limit ?? 50;
  if (dataSource() === "mock") {
    return mockDb.expenseExports
      .filter((e) => !filter.tenantId || e.tenant_id === filter.tenantId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  let q = createAdminClient().from("expense_exports").select("*").order("created_at", { ascending: false }).limit(limit);
  if (filter.tenantId) q = q.eq("tenant_id", filter.tenantId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function getExpenseExport(id: string): Promise<ExpenseExport | null> {
  if (dataSource() === "mock") return mockDb.expenseExports.find((e) => e.id === id) ?? null;
  const { data, error } = await createAdminClient().from("expense_exports").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------------------
// Inventory holds + corporate rate cards
// ----------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type HoldWithEventDate = InventoryHold & { event_date: string };

/** A venue's ACTIVE holds that haven't expired, with each held booking's event date. */
export async function listLiveHolds(venueId: string): Promise<HoldWithEventDate[]> {
  const now = new Date().toISOString();
  if (dataSource() === "mock") {
    return mockDb.holds
      .filter((h) => h.venue_id === venueId && h.status === "ACTIVE" && h.hold_expires_at > now)
      .map((h) => ({ ...h, event_date: mockDb.bookings.find((b) => b.id === h.booking_id)!.event_date }));
  }

  // Two FKs reach bookings (booking_id alone and the consistency key), so name one.
  const { data, error } = await createAdminClient()
    .from("inventory_holds")
    .select("*, booking:bookings!inventory_holds_booking_id_fkey(event_date)")
    .eq("venue_id", venueId)
    .eq("status", "ACTIVE")
    .gt("hold_expires_at", now);
  if (error) throw error;
  type Row = InventoryHold & { booking: { event_date: string } };
  return (data as unknown as Row[]).map(({ booking, ...h }) => ({ ...h, event_date: booking.event_date }));
}

/** CONFIRMED bookings at a venue with event dates in [from, to]. */
export async function listConfirmedVenueBookings(
  venueId: string,
  range: { from: string; to: string }
): Promise<Pick<Booking, "id" | "status" | "event_date">[]> {
  if (dataSource() === "mock") {
    return mockDb.bookings
      .filter((b) => b.venue_id === venueId && b.status === "CONFIRMED" && b.event_date >= range.from && b.event_date <= range.to)
      .map(({ id, status, event_date }) => ({ id, status, event_date }));
  }
  const { data, error } = await createAdminClient()
    .from("bookings")
    .select("id, status, event_date")
    .eq("venue_id", venueId)
    .eq("status", "CONFIRMED")
    .gte("event_date", range.from)
    .lte("event_date", range.to);
  if (error) throw error;
  return data;
}

/** The tenant's rate card for a venue covering eventDate, if any (ranges never overlap). */
export async function getActiveRateCard(
  tenantId: string,
  venueId: string,
  eventDate: string
): Promise<CorporateRateCard | null> {
  // eventDate is interpolated into the PostgREST .or() filter below; only allow a plain date.
  if (!ISO_DATE.test(eventDate)) throw new Error(`Invalid event date: ${eventDate}`);
  if (dataSource() === "mock") {
    return mockDb.rateCards.find((c) => c.tenant_id === tenantId && c.venue_id === venueId && isRateCardActive(c, eventDate)) ?? null;
  }
  const { data, error } = await createAdminClient()
    .from("corporate_rate_cards")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("venue_id", venueId)
    .lte("effective_from", eventDate)
    .or(`effective_to.is.null,effective_to.gte.${eventDate}`)
    .maybeSingle();
  if (error) throw error;
  return (
    data && {
      ...data,
      discount_percentage: Number(data.discount_percentage),
      custom_per_head_rate: numOrNull(data.custom_per_head_rate),
      minimum_spend_override: numOrNull(data.minimum_spend_override),
    }
  );
}

/** Releases a live hold early. Scoped to the venue so one property can't touch another's holds. */
export async function releaseHold(holdId: string, scope: { venueId: string }) {
  if (dataSource() === "mock") {
    const h = mockDb.holds.find((x) => x.id === holdId && x.venue_id === scope.venueId && x.status === "ACTIVE");
    if (!h) throw new Error("This hold was not found or is no longer active.");
    h.status = "RELEASED";
    h.updated_at = new Date().toISOString();
    return;
  }
  const { data, error } = await createAdminClient()
    .from("inventory_holds")
    .update({ status: "RELEASED" })
    .eq("id", holdId)
    .eq("venue_id", scope.venueId)
    .eq("status", "ACTIVE")
    .select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("This hold was not found or is no longer active.");
}
