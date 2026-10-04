import "server-only";

import { calculateGst, roundInr, splitCommission, sumInr, type TaxInvoicePayload } from "@/lib/gst-engine";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import type {
  Booking,
  BookingStatus,
  Company,
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
  if (filter.venueId) query = query.eq("venue_id", filter.venueId);

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

export async function createBookingRequest(input: NewBookingInput): Promise<BookingDetail> {
  const total = roundInr(input.party_size * input.budget_per_head_inr);

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
      status: "PENDING",
      created_at: now,
      updated_at: now,
    };
    mockDb.bookings.push(booking);
    return enrich(booking, c, v);
  }

  // commission_rate is snapshotted from the venue by the bookings_snapshot_commission_rate trigger.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .insert({ ...input, notes: input.notes ?? null, total_amount_inr: total, status: "PENDING" })
    .select("id")
    .single();
  if (error) throw error;
  const [created] = (await listBookings()).filter((b) => b.id === data.id);
  return created;
}

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
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
