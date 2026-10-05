import "server-only";

import { calculateGst, roundInr, splitCommission, sumInr, type TaxInvoicePayload } from "@/lib/gst-engine";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import type {
  ApprovalChain,
  ApprovalStatus,
  Booking,
  BookingApproval,
  BookingStatus,
  Company,
  CorporatePolicy,
  Venue,
  VenueOnboardingRequest,
} from "@/lib/supabase/database.types";
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
    company_gstin: company.gstin,
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
}

export interface NewApprovalRequest {
  requested_by: string;
  approver_id: string;
  /** Why the policy requires sign-off. */
  reason: string;
}

/**
 * Creates a booking. With `approval`, the booking starts as PENDING_APPROVAL and
 * a booking_approvals row is raised for the approver; otherwise it goes straight
 * to the venue as PENDING.
 */
export async function createBookingRequest(input: NewBookingInput, approval?: NewApprovalRequest): Promise<BookingDetail> {
  const total = roundInr(input.party_size * input.budget_per_head_inr);
  const status: BookingStatus = approval ? "PENDING_APPROVAL" : "PENDING";

  if (dataSource() === "mock") {
    const c = mockDb.companies.find((x) => x.id === input.company_id);
    const v = mockDb.venues.find((x) => x.id === input.venue_id);
    if (!c || !v) throw new Error("Unknown company or venue");
    const now = new Date().toISOString();
    const booking: Booking = {
      id: crypto.randomUUID(),
      ...input,
      notes: input.notes ?? null,
      total_amount_inr: total,
      sac_code: "998596",
      gst_type: mockGstType(input.company_id, input.venue_id),
      // Mock equivalent of the bookings_snapshot_commission_rate trigger.
      commission_rate: v.commission_rate,
      status,
      created_at: now,
      updated_at: now,
    };
    mockDb.bookings.push(booking);
    if (approval) {
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
    return enrich(booking, c, v);
  }

  // commission_rate is snapshotted from the venue by the bookings_snapshot_commission_rate trigger.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .insert({ ...input, notes: input.notes ?? null, total_amount_inr: total, status })
    .select("id")
    .single();
  if (error) throw error;
  if (approval) {
    const { error: approvalError } = await supabase
      .from("booking_approvals")
      .insert({ tenant_id: input.company_id, booking_id: data.id, ...approval });
    if (approvalError) {
      // No multi-statement transactions over PostgREST: undo the booking so it
      // can't sit in PENDING_APPROVAL with nobody assigned to approve it.
      await supabase.from("bookings").delete().eq("id", data.id);
      throw approvalError;
    }
  }
  const [created] = (await listBookings()).filter((b) => b.id === data.id);
  return created;
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
    return;
  }

  // The DB trigger bookings_guard_status_transition enforces the same rules.
  let query = createAdminClient().from("bookings").update({ status: next }).eq("id", id);
  if (scope.venueId) query = query.eq("venue_id", scope.venueId);
  const { error } = await query;
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Corporate approval workflows
// ----------------------------------------------------------------------------

export interface PortalUser {
  id: string;
  companyId: string | null;
  name: string;
}

/** Client-portal users (platform_users with role CLIENT), optionally for one tenant. */
export async function listPortalUsers(filter: { companyId?: string } = {}): Promise<PortalUser[]> {
  if (dataSource() === "mock") {
    return mockDb.users
      .filter((u) => !filter.companyId || u.company_id === filter.companyId)
      .map((u) => ({ id: u.user_id, companyId: u.company_id, name: u.name }));
  }

  const supabase = createAdminClient();
  let query = supabase.from("platform_users").select("user_id, company_id").eq("role", "CLIENT");
  if (filter.companyId) query = query.eq("company_id", filter.companyId);
  // platform_users has no name column; label people by their auth email.
  const [{ data, error }, auth] = await Promise.all([query, supabase.auth.admin.listUsers({ perPage: 1000 })]);
  if (error) throw error;
  if (auth.error) throw auth.error;
  const emails = new Map(auth.data.users.map((u) => [u.id, u.email ?? u.id]));
  return data
    .map((u) => ({ id: u.user_id, companyId: u.company_id, name: emails.get(u.user_id) ?? u.user_id }))
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
  return data && { ...data, max_budget_per_head: numOrNull(data.max_budget_per_head), requires_approval_above: numOrNull(data.requires_approval_above) };
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

export interface ApprovalDetail extends BookingApproval {
  company: Pick<Company, "id" | "legal_name">;
  booking: Pick<Booking, "id" | "event_date" | "party_size" | "budget_per_head_inr" | "total_amount_inr" | "status"> & {
    venue_name: string;
  };
  requester_name: string;
  approver_name: string;
}

export async function listApprovals(
  filter: { tenantId?: string; approverId?: string; status?: ApprovalStatus } = {}
): Promise<ApprovalDetail[]> {
  const users = new Map((await listPortalUsers()).map((u) => [u.id, u.name]));
  const named = (a: Omit<ApprovalDetail, "requester_name" | "approver_name">): ApprovalDetail => ({
    ...a,
    requester_name: users.get(a.requested_by) ?? "Unknown user",
    approver_name: users.get(a.approver_id) ?? "Unknown user",
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
