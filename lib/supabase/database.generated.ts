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
      booking_status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED"
      gst_type: "CGST_SGST" | "IGST"
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
      booking_status: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"],
      gst_type: ["CGST_SGST", "IGST"],
      onboarding_status: ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"],
      portal_role: ["ADMIN", "CLIENT", "PROPERTY"],
    },
  },
} as const
