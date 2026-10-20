/**
 * App-facing database types.
 *
 * `database.generated.ts` is pure `supabase gen types` output (`npm run db:types`)
 * and must not be edited by hand. This file layers on what the generator can't
 * know, plus the short aliases the app imports, so regenerating never loses them.
 */

import type { Database as GeneratedDatabase, Enums, Tables } from "./database.generated";

export type { Json, Enums, Tables, TablesInsert, TablesUpdate } from "./database.generated";

// ----------------------------------------------------------------------------
// Trigger-filled columns
// ----------------------------------------------------------------------------
// bookings.gst_type and bookings.commission_rate are NOT NULL without defaults,
// so the generator makes them required on insert. Triggers set both
// (bookings_derive_gst_type, bookings_snapshot_commission_rate) and overwrite any
// caller value, so callers should not have to supply them.

type GeneratedPublic = GeneratedDatabase["public"];
type GeneratedBookings = GeneratedPublic["Tables"]["bookings"];
type TriggerFilledBookingColumn = "gst_type" | "commission_rate";

type BookingsTable = Omit<GeneratedBookings, "Insert"> & {
  Insert: Omit<GeneratedBookings["Insert"], TriggerFilledBookingColumn> &
    Partial<Pick<GeneratedBookings["Insert"], TriggerFilledBookingColumn>>;
};

// inventory_holds.hold_expires_at is NOT NULL with no column default; the
// inventory_holds_before_insert trigger defaults it to hold_start + 24h.
type GeneratedHolds = GeneratedPublic["Tables"]["inventory_holds"];
type HoldsTable = Omit<GeneratedHolds, "Insert"> & {
  Insert: Omit<GeneratedHolds["Insert"], "hold_expires_at"> & { hold_expires_at?: string };
};

// ----------------------------------------------------------------------------
// Concierge memory (migration 0032), until `npm run db:types` is next run
// ----------------------------------------------------------------------------
// Hand-written to match supabase/migrations/20261024120000_concierge_memory.sql.
// Once the generated file includes these tables, delete this block and the
// overrides below. Embeddings travel as pgvector text: JSON.stringify(number[]).

type UserPreferencesRow = {
  user_id: string;
  dietary: string[];
  seating: string | null;
  cuisines: string[];
  budget_limit_per_head_inr: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
type UserPreferencesTable = {
  Row: UserPreferencesRow;
  Insert: Pick<UserPreferencesRow, "user_id"> & Partial<Omit<UserPreferencesRow, "user_id">>;
  Update: Partial<UserPreferencesRow>;
  Relationships: [];
};

type BookingMemoryRow = {
  id: string;
  user_id: string;
  booking_id: string | null;
  kind: "booking" | "feedback" | "note";
  summary: string;
  embedding: string;
  created_at: string;
};
type BookingMemoriesTable = {
  Row: BookingMemoryRow;
  Insert: Pick<BookingMemoryRow, "user_id" | "summary" | "embedding"> & Partial<Omit<BookingMemoryRow, "user_id" | "summary" | "embedding">>;
  Update: Partial<BookingMemoryRow>;
  Relationships: [];
};

type MatchBookingMemories = {
  Args: { query_embedding: string; match_count?: number };
  Returns: { id: string; booking_id: string | null; kind: string; summary: string; created_at: string; similarity: number }[];
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedPublic, "Tables" | "Functions"> & {
    Tables: Omit<GeneratedPublic["Tables"], "bookings" | "inventory_holds"> & {
      bookings: BookingsTable;
      inventory_holds: HoldsTable;
      user_preferences: UserPreferencesTable;
      booking_memories: BookingMemoriesTable;
    };
    Functions: GeneratedPublic["Functions"] & { match_booking_memories: MatchBookingMemories };
  };
};

// ----------------------------------------------------------------------------
// App aliases
// ----------------------------------------------------------------------------

export type GstType = Enums<"gst_type">;
export type BookingStatus = Enums<"booking_status">;
export type OnboardingStatus = Enums<"onboarding_status">;
export type PortalRole = Enums<"portal_role">;
export type ApprovalStatus = Enums<"approval_status">;
export type HoldStatus = Enums<"hold_status">;
export type CorporateRole = Enums<"corporate_role">;
export type PartnerRoleEnum = Enums<"partner_role">;

export type Company = Tables<"companies">;
export type Venue = Tables<"venues">;
export type Booking = Tables<"bookings">;
export type VenueOnboardingRequest = Tables<"venue_onboarding_requests">;
export type CorporatePolicy = Tables<"corporate_policies">;
export type ApprovalChain = Tables<"approval_chains">;
export type BookingApproval = Tables<"booking_approvals">;
export type PlatformUser = Tables<"platform_users">;
export type ApprovalComment = Tables<"approval_comments">;
export type ExpenseExport = Tables<"expense_exports">;
export type InventoryHold = Tables<"inventory_holds">;
export type CorporateRateCard = Tables<"corporate_rate_cards">;
export type Partner = Tables<"partners">;
export type PartnerVenue = Tables<"partner_venues">;
export type PartnerRateCard = Tables<"partner_rate_cards">;
export type PartnerAuditEntry = Tables<"partner_audit_log">;
export type PaymentProvider = Enums<"payment_provider">;
export type PaymentStatus = Enums<"payment_status">;
export type RfpResponseStatus = Enums<"rfp_response_status">;
export type MenuPackage = Tables<"venue_menu_packages">;
export type Payment = Tables<"payments">;
export type Rfp = Tables<"rfps">;
export type RfpResponse = Tables<"rfp_responses">;
export type Department = Tables<"departments">;
export type PurchaseOrder = Tables<"purchase_orders">;
export type PoAllocation = Tables<"po_allocations">;
export type ApprovalPolicyRule = Tables<"approval_policy_rules">;
export type TeamBudgetRow = Tables<"team_budgets">;
export type BudgetHoldRow = Tables<"budget_holds">;
export type ContractRow = Tables<"contracts">;
export type ContractSignatureRow = Tables<"contract_signatures">;
export type ContractEventRow = Tables<"contract_events">;
export type BookingInvoiceRow = Tables<"booking_invoices">;
export type CatalogItem = Tables<"catalog_items">;
export type CatalogOrder = Tables<"catalog_orders">;
export type EventWorkspace = Tables<"event_workspaces">;
export type EventAttendee = Tables<"event_attendees">;
export type EventPlanRow = Tables<"event_plans">;
export type EventCheckin = Tables<"event_checkins">;
export type VendorPayout = Tables<"vendor_payouts">;
export type TcsEntry = Tables<"tcs_entries">;
export type VenueBlockedDate = Tables<"venue_blocked_dates">;
export type VenueNegotiationRules = Tables<"venue_negotiation_rules">;
export type UserPreferences = UserPreferencesRow;
export type BookingMemory = BookingMemoryRow;
