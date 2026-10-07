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
      approval_comments: {
        Row: {
          approval_id: string
          author_id: string
          body: string
          created_at: string
          id: string
          tenant_id: string
        }
        Insert: {
          approval_id: string
          author_id: string
          body: string
          created_at?: string
          id?: string
          tenant_id: string
        }
        Update: {
          approval_id?: string
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_comments_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "booking_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
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
          billing_gstin: string | null
          cost_center: string | null
          project_code: string | null
          budget_per_head_inr: number
          commission_rate: number
          company_id: string
          created_at: string
          department_id: string | null
          event_date: string
          gst_type: Database["public"]["Enums"]["gst_type"]
          id: string
          list_budget_per_head_inr: number | null
          notes: string | null
          party_size: number
          rate_card_id: string | null
          sac_code: string
          status: Database["public"]["Enums"]["booking_status"]
          total_amount_inr: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          billing_gstin?: string | null
          cost_center?: string | null
          project_code?: string | null
          budget_per_head_inr: number
          commission_rate: number
          company_id: string
          created_at?: string
          department_id?: string | null
          event_date: string
          gst_type: Database["public"]["Enums"]["gst_type"]
          id?: string
          list_budget_per_head_inr?: number | null
          notes?: string | null
          party_size: number
          rate_card_id?: string | null
          sac_code?: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount_inr: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          billing_gstin?: string | null
          cost_center?: string | null
          project_code?: string | null
          budget_per_head_inr?: number
          commission_rate?: number
          company_id?: string
          created_at?: string
          department_id?: string | null
          event_date?: string
          gst_type?: Database["public"]["Enums"]["gst_type"]
          id?: string
          list_budget_per_head_inr?: number | null
          notes?: string | null
          party_size?: number
          rate_card_id?: string | null
          sac_code?: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount_inr?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_department_same_company"
            columns: ["department_id", "company_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "bookings_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "corporate_rate_cards"
            referencedColumns: ["id"]
          },
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
      channel_messages: {
        Row: {
          booking_id: string | null
          channel: string
          created_at: string
          delivery_status: string
          duration_ms: number | null
          error: string | null
          id: string
          inbound_text: string
          is_test: boolean
          reply_text: string | null
          sender_id: string
          sender_name: string | null
          status: string
          steps: number
          tokens: number
          tools: string[]
        }
        Insert: {
          booking_id?: string | null
          channel: string
          created_at?: string
          delivery_status?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          inbound_text: string
          is_test?: boolean
          reply_text?: string | null
          sender_id: string
          sender_name?: string | null
          status?: string
          steps?: number
          tokens?: number
          tools?: string[]
        }
        Update: {
          booking_id?: string | null
          channel?: string
          created_at?: string
          delivery_status?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          inbound_text?: string
          is_test?: boolean
          reply_text?: string | null
          sender_id?: string
          sender_name?: string | null
          status?: string
          steps?: number
          tokens?: number
          tools?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "channel_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_sender_links: {
        Row: {
          default_cost_center: string | null
          channel: string
          company_id: string
          created_at: string
          id: string
          sender_id: string
          user_id: string
          user_name: string
        }
        Insert: {
          default_cost_center?: string | null
          channel: string
          company_id: string
          created_at?: string
          id?: string
          sender_id: string
          user_id: string
          user_name: string
        }
        Update: {
          default_cost_center?: string | null
          channel?: string
          company_id?: string
          created_at?: string
          id?: string
          sender_id?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_sender_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_sender_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      channel_settings: {
        Row: {
          channel: string
          enabled: boolean
          updated_at: string
        }
        Insert: {
          channel: string
          enabled?: boolean
          updated_at?: string
        }
        Update: {
          channel?: string
          enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      channel_webhook_receipts: {
        Row: {
          key: string
          received_at: string
        }
        Insert: {
          key: string
          received_at?: string
        }
        Update: {
          key?: string
          received_at?: string
        }
        Relationships: []
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
          high_value_threshold: number | null
          created_at: string
          currency: string
          id: string
          max_budget_per_head: number | null
          requires_approval_above: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          high_value_threshold?: number | null
          created_at?: string
          currency?: string
          id?: string
          max_budget_per_head?: number | null
          requires_approval_above?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          high_value_threshold?: number | null
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
      departments: {
        Row: {
          annual_budget_inr: number
          company_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          annual_budget_inr?: number
          company_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          annual_budget_inr?: number
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_exports: {
        Row: {
          payload: string
          booking_id: string
          created_at: string
          destination: string
          error: string | null
          event: string
          id: string
          payload_sha256: string
          receipt: Json
          response_code: number | null
          status: string
          tenant_id: string
        }
        Insert: {
          payload: string
          booking_id: string
          created_at?: string
          destination: string
          error?: string | null
          event: string
          id?: string
          payload_sha256: string
          receipt: Json
          response_code?: number | null
          status: string
          tenant_id: string
        }
        Update: {
          payload?: string
          booking_id?: string
          created_at?: string
          destination?: string
          error?: string | null
          event?: string
          id?: string
          payload_sha256?: string
          receipt?: Json
          response_code?: number | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_exports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_exports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      partner_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          entity: string
          entity_id: string | null
          id: string
          partner_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          entity: string
          entity_id?: string | null
          id?: string
          partner_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          entity?: string
          entity_id?: string | null
          id?: string
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_audit_log_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_rate_cards: {
        Row: {
          created_at: string
          id: string
          label: string
          min_guests: number
          partner_id: string
          partner_venue_id: string
          per_head_inr: number
          updated_at: string
          updated_by: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          min_guests?: number
          partner_id: string
          partner_venue_id: string
          per_head_inr: number
          updated_at?: string
          updated_by?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          min_guests?: number
          partner_id?: string
          partner_venue_id?: string
          per_head_inr?: number
          updated_at?: string
          updated_by?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_rate_cards_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_rate_cards_partner_venue_id_partner_id_fkey"
            columns: ["partner_venue_id", "partner_id"]
            isOneToOne: false
            referencedRelation: "partner_venues"
            referencedColumns: ["id", "partner_id"]
          },
        ]
      }
      partner_venues: {
        Row: {
          address: string
          area: string
          capacity: number
          city: string
          created_at: string
          id: string
          min_spend_inr: number
          name: string
          partner_id: string
          private_dining: boolean
          ref: string
          status: string
          updated_at: string
        }
        Insert: {
          address?: string
          area: string
          capacity: number
          city?: string
          created_at?: string
          id?: string
          min_spend_inr?: number
          name: string
          partner_id: string
          private_dining?: boolean
          ref: string
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          area?: string
          capacity?: number
          city?: string
          created_at?: string
          id?: string
          min_spend_inr?: number
          name?: string
          partner_id?: string
          private_dining?: boolean
          ref?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_venues_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          contact_email: string | null
          created_at: string
          id: string
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [

        ]
      }
      payment_events: {
        Row: {
          event_id: string
          event_type: string
          payload: Json
          provider: Database["public"]["Enums"]["payment_provider"]
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          payload: Json
          provider: Database["public"]["Enums"]["payment_provider"]
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          payload?: Json
          provider?: Database["public"]["Enums"]["payment_provider"]
          received_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_inr: number
          authorized_at: string | null
          booking_id: string
          captured_at: string | null
          created_at: string
          currency: string
          deposit_rate: number
          id: string
          invoice: Json
          last_error: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_order_id: string
          provider_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          voided_at: string | null
        }
        Insert: {
          amount_inr: number
          authorized_at?: string | null
          booking_id: string
          captured_at?: string | null
          created_at?: string
          currency?: string
          deposit_rate: number
          id?: string
          invoice: Json
          last_error?: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_order_id: string
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          voided_at?: string | null
        }
        Update: {
          amount_inr?: number
          authorized_at?: string | null
          booking_id?: string
          captured_at?: string | null
          created_at?: string
          currency?: string
          deposit_rate?: number
          id?: string
          invoice?: Json
          last_error?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_order_id?: string
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_users: {
        Row: {
          corporate_role: Database["public"]["Enums"]["corporate_role"] | null
          company_id: string | null
          created_at: string
          partner_id: string | null
          partner_role: Database["public"]["Enums"]["partner_role"] | null
          role: Database["public"]["Enums"]["portal_role"]
          user_id: string
          venue_id: string | null
        }
        Insert: {
          corporate_role?: Database["public"]["Enums"]["corporate_role"] | null
          company_id?: string | null
          created_at?: string
          partner_id?: string | null
          partner_role?: Database["public"]["Enums"]["partner_role"] | null
          role: Database["public"]["Enums"]["portal_role"]
          user_id: string
          venue_id?: string | null
        }
        Update: {
          corporate_role?: Database["public"]["Enums"]["corporate_role"] | null
          company_id?: string | null
          created_at?: string
          partner_id?: string | null
          partner_role?: Database["public"]["Enums"]["partner_role"] | null
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
            foreignKeyName: "platform_users_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
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
      rfp_responses: {
        Row: {
          created_at: string
          id: string
          list_amount_inr: number | null
          menu_package_id: string | null
          notes: string | null
          per_head_inr: number | null
          rate_card_id: string | null
          responded_at: string | null
          rfp_id: string
          source: Database["public"]["Enums"]["rfp_response_source"]
          status: Database["public"]["Enums"]["rfp_response_status"]
          taxable_amount_inr: number | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          list_amount_inr?: number | null
          menu_package_id?: string | null
          notes?: string | null
          per_head_inr?: number | null
          rate_card_id?: string | null
          responded_at?: string | null
          rfp_id: string
          source?: Database["public"]["Enums"]["rfp_response_source"]
          status: Database["public"]["Enums"]["rfp_response_status"]
          taxable_amount_inr?: number | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          list_amount_inr?: number | null
          menu_package_id?: string | null
          notes?: string | null
          per_head_inr?: number | null
          rate_card_id?: string | null
          responded_at?: string | null
          rfp_id?: string
          source?: Database["public"]["Enums"]["rfp_response_source"]
          status?: Database["public"]["Enums"]["rfp_response_status"]
          taxable_amount_inr?: number | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfp_responses_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "corporate_rate_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfp_responses_menu_package_id_fkey"
            columns: ["menu_package_id"]
            isOneToOne: false
            referencedRelation: "venue_menu_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfp_responses_rfp_id_fkey"
            columns: ["rfp_id"]
            isOneToOne: false
            referencedRelation: "rfps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfp_responses_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      rfps: {
        Row: {
          brief: string
          budget_per_head_inr: number | null
          city: string | null
          company_id: string
          created_at: string
          created_by: string | null
          dietary_tags: string[]
          event_date: string | null
          id: string
          party_size: number
          requirements: Json
          status: Database["public"]["Enums"]["rfp_status"]
          updated_at: string
        }
        Insert: {
          brief: string
          budget_per_head_inr?: number | null
          city?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          dietary_tags?: string[]
          event_date?: string | null
          id?: string
          party_size: number
          requirements: Json
          status?: Database["public"]["Enums"]["rfp_status"]
          updated_at?: string
        }
        Update: {
          brief?: string
          budget_per_head_inr?: number | null
          city?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          dietary_tags?: string[]
          event_date?: string | null
          id?: string
          party_size?: number
          requirements?: Json
          status?: Database["public"]["Enums"]["rfp_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_menu_packages: {
        Row: {
          created_at: string
          description: string | null
          dietary_tags: string[]
          id: string
          is_active: boolean
          name: string
          per_head_inr: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          dietary_tags?: string[]
          id?: string
          is_active?: boolean
          name: string
          per_head_inr: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          dietary_tags?: string[]
          id?: string
          is_active?: boolean
          name?: string
          per_head_inr?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_menu_packages_venue_id_fkey"
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
          latitude: number | null
          longitude: number | null
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
          latitude?: number | null
          longitude?: number | null
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
          latitude?: number | null
          longitude?: number | null
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
      current_partner_id: { Args: never; Returns: string }
      current_partner_role: {
        Args: never
        Returns: Database["public"]["Enums"]["partner_role"]
      }
      current_portal_role: {
        Args: never
        Returns: Database["public"]["Enums"]["portal_role"]
      }
      current_venue_id: { Args: never; Returns: string }
      gstin_checksum: { Args: { p_first14: string }; Returns: string }
      is_platform_admin: { Args: never; Returns: boolean }
      is_valid_gstin: { Args: { p_gstin: string }; Returns: boolean }
      rfp_company_id: { Args: { p_rfp_id: string }; Returns: string }
      rfp_sent_to_current_venue: {
        Args: { p_rfp_id: string }
        Returns: boolean
      }
    }
    Enums: {
      approval_status: "PENDING" | "APPROVED" | "REJECTED"
      corporate_role: "ORGANIZER" | "APPROVER" | "FINANCE_VIEWER"
      booking_status:
        | "PENDING_APPROVAL"
        | "PENDING"
        | "CONFIRMED"
        | "COMPLETED"
        | "CANCELLED"
      gst_type: "CGST_SGST" | "IGST"
      hold_status: "ACTIVE" | "RELEASED" | "CONVERTED"
      onboarding_status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"
      partner_role: "OWNER" | "MANAGER" | "STAFF"
      portal_role: "ADMIN" | "CLIENT" | "PROPERTY" | "PARTNER"
      payment_provider: "razorpay" | "stripe"
      payment_status:
        | "created"
        | "authorized"
        | "captured"
        | "voided"
        | "failed"
        | "refunded"
      rfp_response_source: "instant" | "venue"
      rfp_response_status: "quoted" | "countered" | "declined" | "no_fit"
      rfp_status: "open" | "awarded" | "closed"
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
      corporate_role: ["ORGANIZER", "APPROVER", "FINANCE_VIEWER"],
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
      partner_role: ["OWNER", "MANAGER", "STAFF"],
      portal_role: ["ADMIN", "CLIENT", "PROPERTY", "PARTNER"],
      payment_provider: ["razorpay", "stripe"],
      payment_status: [
        "created",
        "authorized",
        "captured",
        "voided",
        "failed",
        "refunded",
      ],
      rfp_response_source: ["instant", "venue"],
      rfp_response_status: ["quoted", "countered", "declined", "no_fit"],
      rfp_status: ["open", "awarded", "closed"],
    },
  },
} as const
