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
  PoAllocation,
  PurchaseOrder,
  Venue,
  VenueOnboardingRequest,
} from "@/lib/supabase/database.types";
import { canTransition } from "@/lib/bookings/lifecycle";
import { allocationStatusFor, ineligibility, poBalance, type NewPoInput } from "@/lib/procurement/po-ledger";
import { isRateCardActive } from "@/lib/rates/apply-rate-card";
import type { Json } from "@/lib/supabase/database.generated";
import type { Department } from "@/lib/supabase/database.types";
import { isRedisConfigured, mutateDb, readDb } from "./local-store";
import { mockGstType, type MockDb } from "./mock-store";

/**
 * Single data-access layer for all three portals.
 * - Supabase mode: when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
 * - Redis mode: otherwise, when UPSTASH_REDIS_REST_URL / _TOKEN are set. Persistent,
 *   shared across instances, seeded once from supabase/seed.sql (lib/data/local-store.ts).
 * - Mock mode: neither; an in-memory copy of supabase/seed.sql.
 * Redis and mock share one code path (`local()` below) over the same collections.
 * Tax, commission and payout figures are always computed via lib/gst-engine.ts
 * so the UI and invoices share one source of truth.
 */

export type DataSource = "supabase" | "redis" | "mock";
export const dataSource = (): DataSource => (isSupabaseConfigured() ? "supabase" : isRedisConfigured() ? "redis" : "mock");
/** Redis or in-memory: served by lib/data/local-store.ts rather than Postgres. */
const local = () => dataSource() !== "supabase";

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
  if (local()) return [...(await readDb()).companies].sort((a, b) => a.legal_name.localeCompare(b.legal_name));
  const { data, error } = await createAdminClient().from("companies").select("*").order("legal_name");
  if (error) throw error;
  return data;
}

export async function listVenues(): Promise<Venue[]> {
  if (local()) return (await readDb()).venues.filter((v) => v.is_active).sort((a, b) => a.name.localeCompare(b.name));
  const { data, error } = await createAdminClient()
    .from("venues")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data;
}

export async function listBookings(filter: { companyId?: string; venueId?: string } = {}): Promise<BookingDetail[]> {
  if (local()) {
    const db = await readDb();
    return db.bookings
      .filter((b) => (!filter.companyId || b.company_id === filter.companyId) && (!filter.venueId || b.venue_id === filter.venueId))
      // Venues never see bookings still awaiting the company's internal sign-off.
      .filter((b) => !filter.venueId || b.status !== "PENDING_APPROVAL")
      .sort((a, b) => b.event_date.localeCompare(a.event_date))
      .map((b) => {
        const c = db.companies.find((x) => x.id === b.company_id)!;
        const v = db.venues.find((x) => x.id === b.venue_id)!;
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
  if (local()) {
    return (await readDb()).onboarding
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

/** Departments with their FY budgets, optionally for some companies. */
export async function listDepartments(filter: { companyIds?: string[] } = {}): Promise<Department[]> {
  const { companyIds } = filter;
  if (local()) {
    return (await readDb()).departments
      .filter((d) => !companyIds || companyIds.includes(d.company_id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  let query = createAdminClient().from("departments").select("*").order("name");
  if (companyIds) query = query.in("company_id", companyIds);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((d) => ({ ...d, annual_budget_inr: Number(d.annual_budget_inr) }));
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
  /** What the event includes, for policy compliance (alcohol, entertainment types). */
  alcohol_included?: boolean;
  entertainment?: string[];
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
  options: { approvals?: NewApprovalRequest[]; hold?: NewHoldRequest; allocation?: NewPoAllocation } = {}
): Promise<BookingDetail> {
  const { hold, allocation } = options;
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
    alcohol_included: input.alcohol_included ?? false,
    entertainment: input.entertainment ?? [],
  };

  if (local()) return mutateDb((db) => {
    const c = db.companies.find((x) => x.id === input.company_id);
    const v = db.venues.find((x) => x.id === input.venue_id);
    if (!c || !v) throw new Error("Unknown company or venue");
    const now = new Date().toISOString();
    // Local equivalent of the inventory_holds_before_insert conflict check.
    if (hold && db.holds.some((h) => h.venue_id === v.id && h.status === "ACTIVE" && h.hold_expires_at > now &&
        db.bookings.find((b) => b.id === h.booking_id)?.event_date === input.event_date)) {
      throw new HoldConflictError(v.name, input.event_date);
    }
    const booking: Booking = {
      id: crypto.randomUUID(),
      ...row,
      total_amount_inr: total,
      sac_code: "998596",
      gst_type: mockGstType(db, input.company_id, input.venue_id, row.billing_gstin),
      // Local equivalent of the bookings_snapshot_commission_rate trigger.
      commission_rate: v.commission_rate,
      status,
      settled_at: null,
      expense_reference: null,
      created_at: now,
      updated_at: now,
    };
    db.bookings.push(booking);
    for (const approval of approvals) {
      db.approvals.push({
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
      db.holds.push({
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
    if (allocation) {
      // Local equivalent of the po_allocations_check trigger (the store lock makes it atomic).
      checkLocalAllocation(db, allocation, booking);
      db.poAllocations.push({ id: crypto.randomUUID(), po_id: allocation.po_id, tenant_id: c.id, booking_id: booking.id, amount_inr: total, status: "committed", over_balance: allocation.over_balance, created_at: now, updated_at: now });
    }
    return enrich(booking, c, v);
  });

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
  if (allocation) {
    const { error: allocationError } = await supabase
      .from("po_allocations")
      .insert({ po_id: allocation.po_id, tenant_id: input.company_id, booking_id: data.id, amount_inr: total, over_balance: allocation.over_balance });
    if (allocationError) {
      await undo();
      // po_allocations_check: another booking spent the balance first, or the PO changed.
      if (allocationError.code === "23514") throw new PoAllocationError(allocationError.message);
      throw allocationError;
    }
  }
  const [created] = (await listBookings()).filter((b) => b.id === data.id);
  return created;
}

// ----------------------------------------------------------------------------
// Blanket purchase orders (migration 0020; rules in lib/procurement/po-ledger.ts)
// ----------------------------------------------------------------------------

export interface NewPoAllocation {
  po_id: string;
  /** Allowed past the PO's balance because the booking goes through sign-off. */
  over_balance: boolean;
}

/** A PO refused an allocation (closed, out of window, wrong department, or not enough left). */
export class PoAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoAllocationError";
  }
}

function checkLocalAllocation(db: MockDb, allocation: NewPoAllocation, booking: Pick<Booking, "id" | "company_id" | "event_date" | "department_id" | "total_amount_inr">) {
  const po = db.purchaseOrders.find((p) => p.id === allocation.po_id);
  if (!po) throw new PoAllocationError("Purchase order not found");
  const why = ineligibility(po, { tenantId: booking.company_id, eventDate: booking.event_date, departmentId: booking.department_id });
  if (why) throw new PoAllocationError(why);
  if (!allocation.over_balance) {
    const { remaining } = poBalance(po, db.poAllocations, booking.id);
    if (Number(booking.total_amount_inr) > remaining) {
      const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
      const left = remaining < 0 ? `is overdrawn by ${inr(-remaining)}` : `has ${inr(remaining)} left`;
      throw new PoAllocationError(`PO ${po.po_number} ${left}, not enough for ${inr(Number(booking.total_amount_inr))}`);
    }
  }
}

/** Local equivalent of the bookings_sync_po_allocations trigger. */
function syncLocalAllocations(db: MockDb, bookingId: string, status: BookingStatus) {
  const next = allocationStatusFor(status);
  for (const a of db.poAllocations) {
    if (a.booking_id === bookingId && a.status !== next) Object.assign(a, { status: next, updated_at: new Date().toISOString() });
  }
}

const poRow = (p: PurchaseOrder): PurchaseOrder => ({ ...p, amount_inr: Number(p.amount_inr) });
const allocationRow = (a: PoAllocation): PoAllocation => ({ ...a, amount_inr: Number(a.amount_inr) });

export async function listPurchaseOrders(filter: { tenantId?: string } = {}): Promise<PurchaseOrder[]> {
  if (local()) return (await readDb()).purchaseOrders.filter((p) => !filter.tenantId || p.tenant_id === filter.tenantId).map(poRow);
  let q = createAdminClient().from("purchase_orders").select("*").order("valid_to");
  if (filter.tenantId) q = q.eq("tenant_id", filter.tenantId);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(poRow);
}

export async function listPoAllocations(filter: { tenantId?: string; poId?: string } = {}): Promise<PoAllocation[]> {
  if (local()) {
    return (await readDb()).poAllocations.filter((a) => (!filter.tenantId || a.tenant_id === filter.tenantId) && (!filter.poId || a.po_id === filter.poId)).map(allocationRow);
  }
  let q = createAdminClient().from("po_allocations").select("*").order("created_at", { ascending: false });
  if (filter.tenantId) q = q.eq("tenant_id", filter.tenantId);
  if (filter.poId) q = q.eq("po_id", filter.poId);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(allocationRow);
}

export async function createPurchaseOrder(tenantId: string, input: NewPoInput, createdBy: string | null): Promise<PurchaseOrder> {
  if (local()) {
    return mutateDb((db) => {
      if (db.purchaseOrders.some((p) => p.tenant_id === tenantId && p.po_number === input.po_number)) throw new PoAllocationError(`PO ${input.po_number} already exists.`);
      const now = new Date().toISOString();
      const po: PurchaseOrder = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        po_number: input.po_number,
        description: input.description ?? null,
        department_id: input.department_id ?? null,
        amount_inr: input.amount_inr,
        currency: "INR",
        valid_from: input.valid_from,
        valid_to: input.valid_to,
        status: "open",
        created_by: createdBy,
        created_at: now,
        updated_at: now,
      };
      db.purchaseOrders.push(po);
      return po;
    });
  }
  const { data, error } = await createAdminClient()
    .from("purchase_orders")
    .insert({ tenant_id: tenantId, ...input, created_by: createdBy })
    .select("*")
    .single();
  if (error?.code === "23505") throw new PoAllocationError(`PO ${input.po_number} already exists.`);
  if (error) throw error;
  return poRow(data);
}

/** Opens or closes a PO. Closing keeps its allocations; it just takes no new ones. */
export async function setPurchaseOrderStatus(id: string, tenantId: string, status: "open" | "closed"): Promise<PurchaseOrder> {
  if (local()) {
    return mutateDb((db) => {
      const po = db.purchaseOrders.find((p) => p.id === id && p.tenant_id === tenantId);
      if (!po) throw new PoAllocationError("Purchase order not found");
      Object.assign(po, { status, updated_at: new Date().toISOString() });
      return poRow(po);
    });
  }
  const { data, error } = await createAdminClient().from("purchase_orders").update({ status }).eq("id", id).eq("tenant_id", tenantId).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new PoAllocationError("Purchase order not found");
  return poRow(data);
}

/**
 * Moves a live booking's allocation to another PO (or allocates an unallocated
 * one). Re-checked like a new allocation, so it can't overdraw the target.
 */
export async function reallocateBooking(bookingId: string, tenantId: string, poId: string): Promise<PoAllocation> {
  if (local()) {
    return mutateDb((db) => {
      const booking = db.bookings.find((b) => b.id === bookingId && b.company_id === tenantId);
      if (!booking) throw new PoAllocationError("Booking not found");
      if (booking.status === "CANCELLED") throw new PoAllocationError("Cancelled bookings don't draw from a PO");
      checkLocalAllocation(db, { po_id: poId, over_balance: false }, booking);
      const now = new Date().toISOString();
      const existing = db.poAllocations.find((a) => a.booking_id === bookingId);
      if (existing) {
        Object.assign(existing, { po_id: poId, over_balance: false, amount_inr: Number(booking.total_amount_inr), updated_at: now });
        return allocationRow(existing);
      }
      const created: PoAllocation = { id: crypto.randomUUID(), po_id: poId, tenant_id: tenantId, booking_id: bookingId, amount_inr: Number(booking.total_amount_inr), status: allocationStatusFor(booking.status), over_balance: false, created_at: now, updated_at: now };
      db.poAllocations.push(created);
      return created;
    });
  }
  const db = createAdminClient();
  const { data: booking, error: bookingError } = await db.from("bookings").select("id, status, total_amount_inr").eq("id", bookingId).eq("company_id", tenantId).maybeSingle();
  if (bookingError) throw bookingError;
  if (!booking) throw new PoAllocationError("Booking not found");
  if (booking.status === "CANCELLED") throw new PoAllocationError("Cancelled bookings don't draw from a PO");
  const { data, error } = await db
    .from("po_allocations")
    .upsert(
      { booking_id: bookingId, tenant_id: tenantId, po_id: poId, amount_inr: Number(booking.total_amount_inr), over_balance: false, status: allocationStatusFor(booking.status) },
      { onConflict: "booking_id" }
    )
    .select("*")
    .single();
  if (error?.code === "23514") throw new PoAllocationError(error.message);
  if (error) throw error;
  return allocationRow(data);
}

/** Local equivalent of the bookings_sync_inventory_holds trigger. */
function syncLocalHolds(db: MockDb, bookingId: string, status: BookingStatus) {
  if (status !== "CONFIRMED" && status !== "CANCELLED") return;
  const now = new Date().toISOString();
  for (const h of db.holds) {
    if (h.booking_id === bookingId && h.status === "ACTIVE") {
      h.status = status === "CONFIRMED" ? "CONVERTED" : "RELEASED";
      h.updated_at = now;
    }
  }
}

/**
 * Moves a booking along its lifecycle (lib/bookings/lifecycle.ts). SETTLED
 * stamps settled_at and, when given, the expense system's reference.
 */
export async function updateBookingStatus(id: string, next: BookingStatus, scope: { venueId?: string; companyId?: string; expenseReference?: string | null } = {}) {
  const settled = next === "SETTLED" ? { settled_at: new Date().toISOString(), expense_reference: scope.expenseReference ?? null } : {};
  if (local()) {
    return mutateDb((db) => {
      const b = db.bookings.find((x) => x.id === id && (!scope.venueId || x.venue_id === scope.venueId) && (!scope.companyId || x.company_id === scope.companyId));
      if (!b) throw new Error("Booking not found");
      if (!canTransition(b.status, next)) {
        throw new Error(`Cannot move a ${b.status} booking to ${next}`);
      }
      Object.assign(b, { status: next, updated_at: new Date().toISOString() }, settled);
      syncLocalHolds(db, b.id, next);
      syncLocalAllocations(db, b.id, next);
    });
  }

  // The DB trigger bookings_guard_status_transition enforces the same rules, and
  // bookings_sync_inventory_holds converts/releases the booking's live hold.
  let query = createAdminClient().from("bookings").update({ status: next, ...settled }).eq("id", id);
  if (scope.companyId) query = query.eq("company_id", scope.companyId);
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
  if (local()) {
    return (await readDb()).users
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
  if (local()) return (await readDb()).policies.find((p) => p.tenant_id === tenantId) ?? null;
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
  if (local()) {
    return (await readDb()).approvalChains.filter((c) => c.tenant_id === tenantId).sort((a, b) => a.tier_level - b.tier_level);
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
  if (local()) {
    rows = (await readDb()).approvalChains.filter((c) => !tenantId || c.tenant_id === tenantId);
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

  if (local()) {
    const db = await readDb();
    return db.approvals
      .filter(
        (a) =>
          (!filter.tenantId || a.tenant_id === filter.tenantId) &&
          (!filter.approverId || a.approver_id === filter.approverId) &&
          (!filter.status || a.status === filter.status)
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((a) => {
        const c = db.companies.find((x) => x.id === a.tenant_id)!;
        const b = db.bookings.find((x) => x.id === a.booking_id)!;
        const v = db.venues.find((x) => x.id === b.venue_id)!;
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

  if (local()) {
    return mutateDb((db) => {
      const a = db.approvals.find(
        (x) => x.id === id && x.approver_id === scope.approverId && x.tenant_id === scope.tenantId && x.status === "PENDING"
      );
      if (!a) throw new Error("This approval was not found or has already been decided.");
      const now = new Date().toISOString();
      Object.assign(a, { status: decision, decision_note: note ?? null, decided_at: now, updated_at: now });

      const booking = db.bookings.find((b) => b.id === a.booking_id);
      const othersOpen = db.approvals.some((x) => x.booking_id === a.booking_id && x.id !== a.id && x.status !== "APPROVED");
      if (booking?.status === "PENDING_APPROVAL" && (decision === "REJECTED" || !othersOpen)) {
        booking.status = decision === "REJECTED" ? "CANCELLED" : "PENDING";
        booking.updated_at = now;
        syncLocalHolds(db, booking.id, booking.status);
        syncLocalAllocations(db, booking.id, booking.status);
      }
    });
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
  if (local()) {
    const { approvals } = await readDb();
    const a = approvals.find((x) => x.id === approvalId && x.tenant_id === tenantId);
    return a ? approvals.filter((x) => x.booking_id === a.booking_id) : [];
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
  if (local()) {
    rows = (await readDb()).approvalComments.filter((c) => c.tenant_id === tenantId && approvalIds.includes(c.approval_id));
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
  if (local()) {
    return mutateDb((db) => {
      if (!db.approvals.some((a) => a.id === input.approvalId && a.tenant_id === input.tenantId)) throw new Error("Approval not found.");
      if (!db.users.some((u) => u.user_id === input.authorId && u.company_id === input.tenantId)) throw new Error("Unknown author.");
      db.approvalComments.push({
        id: crypto.randomUUID(),
        approval_id: input.approvalId,
        tenant_id: input.tenantId,
        author_id: input.authorId,
        body,
        created_at: new Date().toISOString(),
      });
    });
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
export type NewExpenseExport = Omit<ExpenseExport, "id" | "created_at" | "updated_at" | "attempts" | "receipt"> & { receipt: Json };

/** The existing export for a booking/event, if any (exports are idempotent per booking + event). */
export async function findExpenseExport(bookingId: string, event: ExpenseExportEvent): Promise<ExpenseExport | null> {
  if (local()) return (await readDb()).expenseExports.find((e) => e.booking_id === bookingId && e.event === event) ?? null;
  const { data, error } = await createAdminClient().from("expense_exports").select("*").eq("booking_id", bookingId).eq("event", event).maybeSingle();
  if (error) throw error;
  return data;
}

/** Records an export. Returns false if one already exists for this booking + event. */
export async function recordExpenseExport(row: NewExpenseExport): Promise<boolean> {
  if (local()) {
    return mutateDb((db) => {
      if (db.expenseExports.some((e) => e.booking_id === row.booking_id && e.event === row.event)) return false;
      const now = new Date().toISOString();
      db.expenseExports.push({ ...row, id: crypto.randomUUID(), attempts: 1, created_at: now, updated_at: now });
      return true;
    });
  }
  const { error } = await createAdminClient().from("expense_exports").insert(row);
  if (error?.code === "23505") return false; // unique (booking_id, event)
  if (error) throw error;
  return true;
}

/**
 * Re-sends a failed export in place (one row per booking + event). Returns false
 * if it is no longer failed (another retry got there first).
 */
export async function retryExpenseExport(id: string, row: NewExpenseExport): Promise<boolean> {
  if (local()) {
    return mutateDb((db) => {
      const e = db.expenseExports.find((x) => x.id === id && x.status === "failed");
      if (!e) return false;
      Object.assign(e, row, { attempts: e.attempts + 1, updated_at: new Date().toISOString() });
      return true;
    });
  }
  const db = createAdminClient();
  const { data: current, error: readError } = await db.from("expense_exports").select("attempts").eq("id", id).eq("status", "failed").maybeSingle();
  if (readError) throw readError;
  if (!current) return false;
  const { data, error } = await db
    .from("expense_exports")
    .update({ ...row, attempts: current.attempts + 1 })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (error) throw error;
  return data.length > 0;
}

export async function listExpenseExports(filter: { tenantId?: string; limit?: number } = {}): Promise<ExpenseExport[]> {
  const limit = filter.limit ?? 50;
  if (local()) {
    return (await readDb()).expenseExports
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
  if (local()) return (await readDb()).expenseExports.find((e) => e.id === id) ?? null;
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
  if (local()) {
    const db = await readDb();
    return db.holds
      .filter((h) => h.venue_id === venueId && h.status === "ACTIVE" && h.hold_expires_at > now)
      .map((h) => ({ ...h, event_date: db.bookings.find((b) => b.id === h.booking_id)!.event_date }));
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
  if (local()) {
    return (await readDb()).bookings
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
/** Active menu packages (Supabase only: the local stores don't model them yet). */
export async function listMenuPackages(): Promise<{ id: string; venue_id: string; name: string; per_head_inr: number }[]> {
  if (local()) return [];
  const { data, error } = await createAdminClient().from("venue_menu_packages").select("id, venue_id, name, per_head_inr").eq("is_active", true);
  if (error) throw error;
  return data.map((p) => ({ ...p, per_head_inr: Number(p.per_head_inr) }));
}

/** Negotiated rate cards, optionally for one tenant and/or venue (admins see all; scope clients to their company). */
export async function listRateCards(filter: { tenantId?: string; venueId?: string } = {}): Promise<CorporateRateCard[]> {
  if (local()) {
    return (await readDb()).rateCards.filter((c) => (!filter.tenantId || c.tenant_id === filter.tenantId) && (!filter.venueId || c.venue_id === filter.venueId));
  }
  let q = createAdminClient().from("corporate_rate_cards").select("*").order("effective_from", { ascending: false });
  if (filter.tenantId) q = q.eq("tenant_id", filter.tenantId);
  if (filter.venueId) q = q.eq("venue_id", filter.venueId);
  const { data, error } = await q;
  if (error) throw error;
  return data.map((c) => ({
    ...c,
    discount_percentage: Number(c.discount_percentage),
    custom_per_head_rate: numOrNull(c.custom_per_head_rate),
    minimum_spend_override: numOrNull(c.minimum_spend_override),
  }));
}

export async function getActiveRateCard(
  tenantId: string,
  venueId: string,
  eventDate: string
): Promise<CorporateRateCard | null> {
  // eventDate is interpolated into the PostgREST .or() filter below; only allow a plain date.
  if (!ISO_DATE.test(eventDate)) throw new Error(`Invalid event date: ${eventDate}`);
  if (local()) {
    return (await readDb()).rateCards.find((c) => c.tenant_id === tenantId && c.venue_id === venueId && isRateCardActive(c, eventDate)) ?? null;
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
  if (local()) {
    return mutateDb((db) => {
      const h = db.holds.find((x) => x.id === holdId && x.venue_id === scope.venueId && x.status === "ACTIVE");
      if (!h) throw new Error("This hold was not found or is no longer active.");
      h.status = "RELEASED";
      h.updated_at = new Date().toISOString();
    });
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
