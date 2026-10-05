export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      approval_chains: {
        Row: {
          approver_user_id: string
          created_at: string
          id: string
          tenant_id: string
          tier_level: number
        }
        Insert: {
          approver_user_id: string
          created_at?: string
          id?: string
          tenant_id: string
          tier_level: number
        }
        Update: {
          approver_user_id?: string
          created_at?: string
          id?: string
          tenant_id?: string
          tier_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "approval_chains_approver_fkey"
            columns: ["approver_user_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["user_id", "company_id"]
          },
          {
            foreignKeyName: "approval_chains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_approvals: {
        Row: {
          approver_id: string
          booking_id: string
          created_at: string
          decided_at: string | null
          decision_note: string | null
          id: string
          reason: string | null
          requested_by: string
          status: Database["public"]["Enums"]["approval_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approver_id: string
          booking_id: string
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          id?: string
          reason?: string | null
          requested_by?: string
          status?: Database["public"]["Enums"]["approval_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approver_id?: string
          booking_id?: string
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          id?: string
          reason?: string | null
          requested_by?: string
          status?: Database["public"]["Enums"]["approval_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_approvals_approver_fkey"
            columns: ["approver_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["user_id", "company_id"]
          },
          {
            foreignKeyName: "booking_approvals_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "booking_approvals_requested_by_fkey"
            columns: ["requested_by", "tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["user_id", "company_id"]
          },
          {
            foreignKeyName: "booking_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          budget_per_head_inr: number
          commission_rate: number
          company_id: string
          created_at: string
          event_date: string
          gst_type: Database["public"]["Enums"]["gst_type"]
          id: string
          notes: string | null
          party_size: number
          sac_code: string
          status: Database["public"]["Enums"]["booking_status"]
          total_amount_inr: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          budget_per_head_inr: number
          commission_rate: number
          company_id: string
          created_at?: string
          event_date: string
          gst_type: Database["public"]["Enums"]["gst_type"]
          id?: string
          notes?: string | null
          party_size: number
          sac_code?: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount_inr: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          budget_per_head_inr?: number
          commission_rate?: number
          company_id?: string
          created_at?: string
          event_date?: string
          gst_type?: Database["public"]["Enums"]["gst_type"]
          id?: string
          notes?: string | null
          party_size?: number
          sac_code?: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount_inr?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          gstin: string
          id: string
          legal_name: string
          monthly_spend_limit_inr: number
          primary_contact_email: string
          state_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          gstin: string
          id?: string
          legal_name: string
          monthly_spend_limit_inr?: number
          primary_contact_email: string
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          gstin?: string
          id?: string
          legal_name?: string
          monthly_spend_limit_inr?: number
          primary_contact_email?: string
          state_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_state_code_fkey"
            columns: ["state_code"]
            isOneToOne: false
            referencedRelation: "gst_state_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      corporate_policies: {
        Row: {
          created_at: string
          currency: string
          id: string
          max_budget_per_head: number | null
          requires_approval_above: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          max_budget_per_head?: number | null
          requires_approval_above?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          max_budget_per_head?: number | null
          requires_approval_above?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_rate_cards: {
        Row: {
          created_at: string
          custom_per_head_rate: number | null
          discount_percentage: number
          effective_from: string
          effective_to: string | null
          id: string
          minimum_spend_override: number | null
          tenant_id: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          custom_per_head_rate?: number | null
          discount_percentage?: number
          effective_from: string
          effective_to?: string | null
          id?: string
          minimum_spend_override?: number | null
          tenant_id: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          custom_per_head_rate?: number | null
          discount_percentage?: number
          effective_from?: string
          effective_to?: string | null
          id?: string
          minimum_spend_override?: number | null
          tenant_id?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_rate_cards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_rate_cards_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_state_codes: {
        Row: {
          code: string
          is_union_territory: boolean
          name: string
        }
        Insert: {
          code: string
          is_union_territory?: boolean
          name: string
        }
        Update: {
          code?: string
          is_union_territory?: boolean
          name?: string
        }
        Relationships: []
      }
      inventory_holds: {
        Row: {
          booking_id: string
          created_at: string
          hold_expires_at: string
          hold_start: string
          id: string
          status: Database["public"]["Enums"]["hold_status"]
          tenant_id: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          hold_expires_at: string
          hold_start?: string
          id?: string
          status?: Database["public"]["Enums"]["hold_status"]
          tenant_id: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          hold_expires_at?: string
          hold_start?: string
          id?: string
          status?: Database["public"]["Enums"]["hold_status"]
          tenant_id?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_holds_booking_consistency_fkey"
            columns: ["booking_id", "tenant_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id", "venue_id"]
          },
          {
            foreignKeyName: "inventory_holds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_holds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_holds_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_users: {
        Row: {
          company_id: string | null
          created_at: string
          role: Database["public"]["Enums"]["portal_role"]
          user_id: string
          venue_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          role: Database["public"]["Enums"]["portal_role"]
          user_id: string
          venue_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          role?: Database["public"]["Enums"]["portal_role"]
          user_id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_users_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_onboarding_requests: {
        Row: {
          capacity_max: number | null
          city: string
          contact_email: string
          contact_name: string
          gstin: string
          id: string
          neighborhood: string
          pdr_available: boolean
          proposed_commission_rate: number
          reviewed_at: string | null
          status: Database["public"]["Enums"]["onboarding_status"]
          submitted_at: string
          venue_id: string | null
          venue_name: string
        }
        Insert: {
          capacity_max?: number | null
          city: string
          contact_email: string
          contact_name: string
          gstin: string
          id?: string
          neighborhood: string
          pdr_available?: boolean
          proposed_commission_rate?: number
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["onboarding_status"]
          submitted_at?: string
          venue_id?: string | null
          venue_name: string
        }
        Update: {
          capacity_max?: number | null
          city?: string
          contact_email?: string
          contact_name?: string
          gstin?: string
          id?: string
          neighborhood?: string
          pdr_available?: boolean
          proposed_commission_rate?: number
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["onboarding_status"]
          submitted_at?: string
          venue_id?: string | null
          venue_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_onboarding_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string
          capacity_max: number
          city: string
          commission_rate: number
          created_at: string
          gstin: string
          id: string
          is_active: boolean
          min_spend_inr: number
          name: string
          neighborhood: string
          pdr_available: boolean
          state_code: string | null
          updated_at: string
        }
        Insert: {
          address: string
          capacity_max: number
          city: string
          commission_rate?: number
          created_at?: string
          gstin: string
          id?: string
          is_active?: boolean
          min_spend_inr?: number
          name: string
          neighborhood: string
          pdr_available?: boolean
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          capacity_max?: number
          city?: string
          commission_rate?: number
          created_at?: string
          gstin?: string
          id?: string
          is_active?: boolean
          min_spend_inr?: number
          name?: string
          neighborhood?: string
          pdr_available?: boolean
          state_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_state_code_fkey"
            columns: ["state_code"]
            isOneToOne: false
            referencedRelation: "gst_state_codes"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      booking_tax_breakdown: {
        Row: {
          booking_id: string | null
          cgst_inr: number | null
          commission_inr: number | null
          company_id: string | null
          event_date: string | null
          gst_type: Database["public"]["Enums"]["gst_type"] | null
          igst_inr: number | null
          sac_code: string | null
          sgst_inr: number | null
          status: Database["public"]["Enums"]["booking_status"] | null
          taxable_value_inr: number | null
          total_gst_inr: number | null
          venue_id: string | null
          venue_payout_inr: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      company_itc_summary: {
        Row: {
          committed_spend_inr: number | null
          company_id: string | null
          itc_pipeline_inr: number | null
          itc_reclaimed_inr: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_metrics: {
        Row: {
          commission_earned_inr: number | null
          gross_booking_value_inr: number | null
          pending_bookings: number | null
          total_bookings: number | null
        }
        Relationships: []
      }
      venue_monthly_payouts: {
        Row: {
          bookings: number | null
          commission_inr: number | null
          fully_settled: boolean | null
          payout_inr: number | null
          payout_month: string | null
          taxable_value_inr: number | null
          venue_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_company_id: { Args: never; Returns: string }
      current_portal_role: {
        Args: never
        Returns: Database["public"]["Enums"]["portal_role"]
      }
      current_venue_id: { Args: never; Returns: string }
      gstin_checksum: { Args: { p_first14: string }; Returns: string }
      is_platform_admin: { Args: never; Returns: boolean }
      is_valid_gstin: { Args: { p_gstin: string }; Returns: boolean }
    }
    Enums: {
      approval_status: "PENDING" | "APPROVED" | "REJECTED"
      booking_status:
        | "PENDING_APPROVAL"
        | "PENDING"
        | "CONFIRMED"
        | "COMPLETED"
        | "CANCELLED"
      gst_type: "CGST_SGST" | "IGST"
      hold_status: "ACTIVE" | "RELEASED" | "CONVERTED"
      onboarding_status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"
      portal_role: "ADMIN" | "CLIENT" | "PROPERTY"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      approval_status: ["PENDING", "APPROVED", "REJECTED"],
      booking_status: [
        "PENDING_APPROVAL",
        "PENDING",
        "CONFIRMED",
        "COMPLETED",
        "CANCELLED",
      ],
      gst_type: ["CGST_SGST", "IGST"],
      hold_status: ["ACTIVE", "RELEASED", "CONVERTED"],
      onboarding_status: ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"],
      portal_role: ["ADMIN", "CLIENT", "PROPERTY"],
    },
  },
} as const
