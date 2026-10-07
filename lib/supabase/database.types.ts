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

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedPublic, "Tables"> & {
    Tables: Omit<GeneratedPublic["Tables"], "bookings" | "inventory_holds"> & {
      bookings: BookingsTable;
      inventory_holds: HoldsTable;
    };
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
