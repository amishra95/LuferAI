/**
 * Database types for the Supabase client.
 *
 * Hand-written to match supabase/migrations. Once a local Supabase stack is
 * running, regenerate with:  npm run db:types
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GstType = "CGST_SGST" | "IGST";
export type BookingStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
export type OnboardingStatus = "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
export type PortalRole = "ADMIN" | "CLIENT" | "PROPERTY";

export type Database = {
  public: {
    Tables: {
      gst_state_codes: {
        Row: { code: string; name: string; is_union_territory: boolean };
        Insert: { code: string; name: string; is_union_territory?: boolean };
        Update: { code?: string; name?: string; is_union_territory?: boolean };
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          legal_name: string;
          gstin: string;
          state_code: string;
          primary_contact_email: string;
          monthly_spend_limit_inr: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          legal_name: string;
          gstin: string;
          primary_contact_email: string;
          monthly_spend_limit_inr?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Insert"]>;
        Relationships: [];
      };
      venues: {
        Row: {
          id: string;
          name: string;
          city: string;
          neighborhood: string;
          address: string;
          gstin: string;
          state_code: string;
          pdr_available: boolean;
          capacity_max: number;
          min_spend_inr: number;
          commission_rate: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          city: string;
          neighborhood: string;
          address: string;
          gstin: string;
          pdr_available?: boolean;
          capacity_max: number;
          min_spend_inr?: number;
          commission_rate?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["venues"]["Insert"]>;
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          company_id: string;
          venue_id: string;
          party_size: number;
          budget_per_head_inr: number;
          total_amount_inr: number;
          sac_code: string;
          gst_type: GstType;
          status: BookingStatus;
          event_date: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          venue_id: string;
          party_size: number;
          budget_per_head_inr: number;
          total_amount_inr: number;
          sac_code?: string;
          /** Overwritten by the bookings_derive_gst_type trigger. */
          gst_type?: GstType;
          status?: BookingStatus;
          event_date: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "bookings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venues";
            referencedColumns: ["id"];
          },
        ];
      };
      venue_onboarding_requests: {
        Row: {
          id: string;
          venue_name: string;
          city: string;
          neighborhood: string;
          gstin: string;
          contact_name: string;
          contact_email: string;
          capacity_max: number | null;
          pdr_available: boolean;
          proposed_commission_rate: number;
          status: OnboardingStatus;
          venue_id: string | null;
          submitted_at: string;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          venue_name: string;
          city: string;
          neighborhood: string;
          gstin: string;
          contact_name: string;
          contact_email: string;
          capacity_max?: number | null;
          pdr_available?: boolean;
          proposed_commission_rate?: number;
          status?: OnboardingStatus;
          venue_id?: string | null;
          submitted_at?: string;
          reviewed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["venue_onboarding_requests"]["Insert"]>;
        Relationships: [];
      };
      platform_users: {
        Row: {
          user_id: string;
          role: PortalRole;
          company_id: string | null;
          venue_id: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          role: PortalRole;
          company_id?: string | null;
          venue_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["platform_users"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      platform_metrics: {
        Row: {
          total_bookings: number;
          pending_bookings: number;
          gross_booking_value_inr: number;
          commission_earned_inr: number;
        };
        Relationships: [];
      };
      venue_monthly_payouts: {
        Row: {
          venue_id: string;
          payout_month: string;
          bookings: number;
          taxable_value_inr: number;
          commission_inr: number;
          payout_inr: number;
          fully_settled: boolean;
        };
        Relationships: [];
      };
      company_itc_summary: {
        Row: {
          company_id: string;
          itc_reclaimed_inr: number;
          itc_pipeline_inr: number;
          committed_spend_inr: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_valid_gstin: { Args: { p_gstin: string }; Returns: boolean };
      gstin_checksum: { Args: { p_first14: string }; Returns: string };
    };
    Enums: {
      gst_type: GstType;
      booking_status: BookingStatus;
      onboarding_status: OnboardingStatus;
      portal_role: PortalRole;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Company = Tables<"companies">;
export type Venue = Tables<"venues">;
export type Booking = Tables<"bookings">;
export type VenueOnboardingRequest = Tables<"venue_onboarding_requests">;
