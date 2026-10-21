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
      agent_configurations: {
        Row: {
          agent_key: string
          enabled: boolean
          id: string
          max_steps: number
          model_backend: string
          system_prompt: string
          temperature: number | null
          tools: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agent_key: string
          enabled?: boolean
          id?: string
          max_steps?: number
          model_backend?: string
          system_prompt?: string
          temperature?: number | null
          tools?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agent_key?: string
          enabled?: boolean
          id?: string
          max_steps?: number
          model_backend?: string
          system_prompt?: string
          temperature?: number | null
          tools?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      agent_execution_logs: {
        Row: {
          agent_key: string
          completion_tokens: number
          cost: number | null
          executed_at: string
          id: string
          model: string
          prompt_tokens: number
          source: string
        }
        Insert: {
          agent_key: string
          completion_tokens?: number
          cost?: number | null
          executed_at?: string
          id?: string
          model: string
          prompt_tokens?: number
          source?: string
        }
        Update: {
          agent_key?: string
          completion_tokens?: number
          cost?: number | null
          executed_at?: string
          id?: string
          model?: string
          prompt_tokens?: number
          source?: string
        }
        Relationships: []
      }
      agent_prompt_versions: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          prompt_key: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          prompt_key: string
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          prompt_key?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
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
            foreignKeyName: "approval_comments_author_fkey"
            columns: ["author_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["user_id", "company_id"]
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
      approval_policy_rules: {
        Row: {
          approval_levels: number
          created_at: string
          created_by: string | null
          department_id: string | null
          id: string
          is_active: boolean
          max_amount_inr: number | null
          min_amount_inr: number
          name: string
          sla_hours: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approval_levels: number
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          max_amount_inr?: number | null
          min_amount_inr?: number
          name: string
          sla_hours?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approval_levels?: number
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          max_amount_inr?: number | null
          min_amount_inr?: number
          name?: string
          sla_hours?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_policy_rules_department_fkey"
            columns: ["department_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "approval_policy_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_approvals: {
        Row: {
          activated_at: string | null
          approver_id: string
          booking_id: string | null
          catalog_order_id: string | null
          created_at: string
          decided_at: string | null
          decision_note: string | null
          due_at: string | null
          escalated_from: string | null
          id: string
          reason: string | null
          requested_by: string
          rule_id: string | null
          status: Database["public"]["Enums"]["approval_status"]
          step: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          approver_id: string
          booking_id?: string | null
          catalog_order_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          due_at?: string | null
          escalated_from?: string | null
          id?: string
          reason?: string | null
          requested_by?: string
          rule_id?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          step?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          approver_id?: string
          booking_id?: string | null
          catalog_order_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          due_at?: string | null
          escalated_from?: string | null
          id?: string
          reason?: string | null
          requested_by?: string
          rule_id?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          step?: number
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
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "booking_approvals_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "booking_approvals_escalated_from_fkey"
            columns: ["escalated_from"]
            isOneToOne: false
            referencedRelation: "booking_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_approvals_order_fkey"
            columns: ["catalog_order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "booking_approvals_requested_by_fkey"
            columns: ["requested_by", "tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_users"
            referencedColumns: ["user_id", "company_id"]
          },
          {
            foreignKeyName: "booking_approvals_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "approval_policy_rules"
            referencedColumns: ["id"]
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
      booking_invoices: {
        Row: {
          booking_id: string
          cgst_inr: number
          contract_id: string
          created_at: string
          due_on: string
          gst: Json
          id: string
          igst_inr: number
          invoice_number: string | null
          issue_on: string
          issued_at: string | null
          kind: string
          paid_at: string | null
          payment_id: string | null
          sequence: number
          sgst_inr: number
          status: string
          taxable_inr: number
          tenant_id: string
          total_inr: number
          updated_at: string
          venue_id: string
          voided_at: string | null
        }
        Insert: {
          booking_id: string
          cgst_inr?: number
          contract_id: string
          created_at?: string
          due_on: string
          gst: Json
          id?: string
          igst_inr?: number
          invoice_number?: string | null
          issue_on: string
          issued_at?: string | null
          kind: string
          paid_at?: string | null
          payment_id?: string | null
          sequence: number
          sgst_inr?: number
          status?: string
          taxable_inr: number
          tenant_id: string
          total_inr: number
          updated_at?: string
          venue_id: string
          voided_at?: string | null
        }
        Update: {
          booking_id?: string
          cgst_inr?: number
          contract_id?: string
          created_at?: string
          due_on?: string
          gst?: Json
          id?: string
          igst_inr?: number
          invoice_number?: string | null
          issue_on?: string
          issued_at?: string | null
          kind?: string
          paid_at?: string | null
          payment_id?: string | null
          sequence?: number
          sgst_inr?: number
          status?: string
          taxable_inr?: number
          tenant_id?: string
          total_inr?: number
          updated_at?: string
          venue_id?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_invoices_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "booking_invoices_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "booking_invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_invoices_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_invoices_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_memories: {
        Row: {
          booking_id: string | null
          created_at: string
          embedding: string
          id: string
          kind: string
          summary: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          embedding: string
          id?: string
          kind?: string
          summary: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          embedding?: string
          id?: string
          kind?: string
          summary?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_memories_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_memories_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          alcohol_included: boolean
          billing_gstin: string | null
          budget_per_head_inr: number
          commission_rate: number
          company_id: string
          cost_center: string | null
          created_at: string
          department_id: string | null
          entertainment: string[]
          event_date: string
          expense_reference: string | null
          gst_type: Database["public"]["Enums"]["gst_type"]
          id: string
          list_budget_per_head_inr: number | null
          notes: string | null
          party_size: number
          project_code: string | null
          rate_card_id: string | null
          requested_by: string | null
          sac_code: string
          settled_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_amount_inr: number
          updated_at: string
          venue_accepted_at: string | null
          venue_id: string
        }
        Insert: {
          alcohol_included?: boolean
          billing_gstin?: string | null
          budget_per_head_inr: number
          commission_rate: number
          company_id: string
          cost_center?: string | null
          created_at?: string
          department_id?: string | null
          entertainment?: string[]
          event_date: string
          expense_reference?: string | null
          gst_type: Database["public"]["Enums"]["gst_type"]
          id?: string
          list_budget_per_head_inr?: number | null
          notes?: string | null
          party_size: number
          project_code?: string | null
          rate_card_id?: string | null
          requested_by?: string | null
          sac_code?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount_inr: number
          updated_at?: string
          venue_accepted_at?: string | null
          venue_id: string
        }
        Update: {
          alcohol_included?: boolean
          billing_gstin?: string | null
          budget_per_head_inr?: number
          commission_rate?: number
          company_id?: string
          cost_center?: string | null
          created_at?: string
          department_id?: string | null
          entertainment?: string[]
          event_date?: string
          expense_reference?: string | null
          gst_type?: Database["public"]["Enums"]["gst_type"]
          id?: string
          list_budget_per_head_inr?: number | null
          notes?: string | null
          party_size?: number
          project_code?: string | null
          rate_card_id?: string | null
          requested_by?: string | null
          sac_code?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount_inr?: number
          updated_at?: string
          venue_accepted_at?: string | null
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
            foreignKeyName: "bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_holds: {
        Row: {
          amount_inr: number
          booking_id: string | null
          budget_id: string
          catalog_order_id: string | null
          created_at: string
          id: string
          over_budget: boolean
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_inr: number
          booking_id?: string | null
          budget_id: string
          catalog_order_id?: string | null
          created_at?: string
          id?: string
          over_budget?: boolean
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_inr?: number
          booking_id?: string | null
          budget_id?: string
          catalog_order_id?: string | null
          created_at?: string
          id?: string
          over_budget?: boolean
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_holds_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "budget_holds_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "budget_holds_budget_fkey"
            columns: ["budget_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "team_budgets"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "budget_holds_order_fkey"
            columns: ["catalog_order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "budget_holds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          attributes: Json
          category: string
          created_at: string
          description: string | null
          gst_rate_percent: number
          id: string
          max_quantity: number | null
          min_quantity: number
          name: string
          partner_id: string
          ref: string
          status: string
          stock_quantity: number | null
          tax_code: string
          tax_kind: string
          unit_price_inr: number
          updated_at: string
        }
        Insert: {
          attributes?: Json
          category: string
          created_at?: string
          description?: string | null
          gst_rate_percent: number
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          name: string
          partner_id: string
          ref: string
          status?: string
          stock_quantity?: number | null
          tax_code: string
          tax_kind: string
          unit_price_inr: number
          updated_at?: string
        }
        Update: {
          attributes?: Json
          category?: string
          created_at?: string
          description?: string | null
          gst_rate_percent?: number
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          name?: string
          partner_id?: string
          ref?: string
          status?: string
          stock_quantity?: number | null
          tax_code?: string
          tax_kind?: string
          unit_price_inr?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_orders: {
        Row: {
          category: string
          commission_rate: number | null
          cost_center: string
          created_at: string
          department_id: string | null
          event_date: string | null
          id: string
          invoice: Json
          item_id: string
          needed_by: string | null
          notes: string | null
          partner_id: string
          project_code: string | null
          quantity: number
          recipients: Json
          requested_by: string | null
          selections: Json
          settled_at: string | null
          status: string
          tenant_id: string
          total_amount_inr: number
          tracking: Json | null
          unit_price_inr: number
          updated_at: string
        }
        Insert: {
          category: string
          commission_rate?: number | null
          cost_center: string
          created_at?: string
          department_id?: string | null
          event_date?: string | null
          id?: string
          invoice: Json
          item_id: string
          needed_by?: string | null
          notes?: string | null
          partner_id: string
          project_code?: string | null
          quantity: number
          recipients?: Json
          requested_by?: string | null
          selections?: Json
          settled_at?: string | null
          status?: string
          tenant_id: string
          total_amount_inr: number
          tracking?: Json | null
          unit_price_inr: number
          updated_at?: string
        }
        Update: {
          category?: string
          commission_rate?: number | null
          cost_center?: string
          created_at?: string
          department_id?: string | null
          event_date?: string | null
          id?: string
          invoice?: Json
          item_id?: string
          needed_by?: string | null
          notes?: string | null
          partner_id?: string
          project_code?: string | null
          quantity?: number
          recipients?: Json
          requested_by?: string | null
          selections?: Json
          settled_at?: string | null
          status?: string
          tenant_id?: string
          total_amount_inr?: number
          tracking?: Json | null
          unit_price_inr?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_orders_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_orders_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id"]
          },
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
          channel: string
          company_id: string
          created_at: string
          default_cost_center: string | null
          id: string
          sender_id: string
          user_id: string
          user_name: string
        }
        Insert: {
          channel: string
          company_id: string
          created_at?: string
          default_cost_center?: string | null
          id?: string
          sender_id: string
          user_id: string
          user_name: string
        }
        Update: {
          channel?: string
          company_id?: string
          created_at?: string
          default_cost_center?: string | null
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
          contracts_required: boolean
          created_at: string
          expense_provider: string
          gstin: string
          id: string
          legal_name: string
          monthly_spend_limit_inr: number
          primary_contact_email: string
          state_code: string | null
          updated_at: string
        }
        Insert: {
          contracts_required?: boolean
          created_at?: string
          expense_provider?: string
          gstin: string
          id?: string
          legal_name: string
          monthly_spend_limit_inr?: number
          primary_contact_email: string
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          contracts_required?: boolean
          created_at?: string
          expense_provider?: string
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
      contract_events: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          at: string
          contract_id: string
          detail: Json
          id: string
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          at?: string
          contract_id: string
          detail?: Json
          id?: string
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          at?: string
          contract_id?: string
          detail?: Json
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signatures: {
        Row: {
          contract_id: string
          document_sha256: string
          id: string
          ip_address: string | null
          party: string
          provider_signature_id: string | null
          signed_at: string
          signer_email: string | null
          signer_name: string
          signer_title: string | null
          signer_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          contract_id: string
          document_sha256: string
          id?: string
          ip_address?: string | null
          party: string
          provider_signature_id?: string | null
          signed_at?: string
          signer_email?: string | null
          signer_name: string
          signer_title?: string | null
          signer_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          contract_id?: string
          document_sha256?: string
          id?: string
          ip_address?: string | null
          party?: string
          provider_signature_id?: string | null
          signed_at?: string
          signer_email?: string | null
          signer_name?: string
          signer_title?: string | null
          signer_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          payload: Json
          provider: string
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          payload: Json
          provider: string
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          payload?: Json
          provider?: string
          received_at?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          booking_id: string
          close_reason: string | null
          closed_at: string | null
          created_at: string
          document_html: string
          document_sha256: string
          executed_at: string | null
          id: string
          issued_at: string
          issued_by: string | null
          provider: string
          provider_request_id: string | null
          revision: number
          status: string
          template_key: string
          template_version: string
          tenant_id: string
          terms: Json
          updated_at: string
          venue_id: string
        }
        Insert: {
          booking_id: string
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          document_html: string
          document_sha256: string
          executed_at?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          provider?: string
          provider_request_id?: string | null
          revision?: number
          status?: string
          template_key: string
          template_version: string
          tenant_id: string
          terms: Json
          updated_at?: string
          venue_id: string
        }
        Update: {
          booking_id?: string
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          document_html?: string
          document_sha256?: string
          executed_at?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          provider?: string
          provider_request_id?: string | null
          revision?: number
          status?: string
          template_key?: string
          template_version?: string
          tenant_id?: string
          terms?: Json
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "contracts_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_policies: {
        Row: {
          alcohol_policy: string
          created_at: string
          currency: string
          high_value_threshold: number | null
          id: string
          max_budget_per_head: number | null
          requires_approval_above: number | null
          restricted_entertainment: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          alcohol_policy?: string
          created_at?: string
          currency?: string
          high_value_threshold?: number | null
          id?: string
          max_budget_per_head?: number | null
          requires_approval_above?: number | null
          restricted_entertainment?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          alcohol_policy?: string
          created_at?: string
          currency?: string
          high_value_threshold?: number | null
          id?: string
          max_budget_per_head?: number | null
          requires_approval_above?: number | null
          restricted_entertainment?: string[]
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
      department_policies: {
        Row: {
          created_at: string
          department_id: string
          max_budget_per_head_inr: number | null
          senior_approval_above_inr: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          max_budget_per_head_inr?: number | null
          senior_approval_above_inr?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          max_budget_per_head_inr?: number | null
          senior_approval_above_inr?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_policies_department_fkey"
            columns: ["department_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "department_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      event_attendees: {
        Row: {
          booking_id: string
          created_at: string
          dietary: string | null
          email: string
          id: string
          invited_by: string | null
          name: string
          plus_ones: number
          responded_at: string | null
          rsvp_status: string
          rsvp_token: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          dietary?: string | null
          email: string
          id?: string
          invited_by?: string | null
          name: string
          plus_ones?: number
          responded_at?: string | null
          rsvp_status?: string
          rsvp_token?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          dietary?: string | null
          email?: string
          id?: string
          invited_by?: string | null
          name?: string
          plus_ones?: number
          responded_at?: string | null
          rsvp_status?: string
          rsvp_token?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendees_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "event_attendees_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "event_attendees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      event_checkins: {
        Row: {
          attendee_id: string
          booking_id: string
          checked_in_at: string
          checked_in_by: string | null
          tenant_id: string
        }
        Insert: {
          attendee_id: string
          booking_id: string
          checked_in_at?: string
          checked_in_by?: string | null
          tenant_id: string
        }
        Update: {
          attendee_id?: string
          booking_id?: string
          checked_in_at?: string
          checked_in_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_checkins_attendee_id_fkey"
            columns: ["attendee_id"]
            isOneToOne: true
            referencedRelation: "event_attendees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_checkins_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "event_checkins_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "event_checkins_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      event_plans: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_revision: number | null
          booking_id: string
          catering_package_id: string | null
          created_at: string
          revision: number
          run_of_show: Json
          special_requirements: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          venue_ack_at: string | null
          venue_ack_by: string | null
          venue_ack_revision: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_revision?: number | null
          booking_id: string
          catering_package_id?: string | null
          created_at?: string
          revision?: number
          run_of_show?: Json
          special_requirements?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          venue_ack_at?: string | null
          venue_ack_by?: string | null
          venue_ack_revision?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_revision?: number | null
          booking_id?: string
          catering_package_id?: string | null
          created_at?: string
          revision?: number
          run_of_show?: Json
          special_requirements?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          venue_ack_at?: string | null
          venue_ack_by?: string | null
          venue_ack_revision?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_plans_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "event_plans_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "event_plans_catering_package_id_fkey"
            columns: ["catering_package_id"]
            isOneToOne: false
            referencedRelation: "venue_menu_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      event_workspaces: {
        Row: {
          booking_id: string
          created_at: string
          ends_at: string
          ics_sequence: number
          id: string
          rsvp_deadline: string | null
          starts_at: string
          tenant_id: string
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          ends_at?: string
          ics_sequence?: number
          id?: string
          rsvp_deadline?: string | null
          starts_at?: string
          tenant_id: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          ends_at?: string
          ics_sequence?: number
          id?: string
          rsvp_deadline?: string | null
          starts_at?: string
          tenant_id?: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_workspaces_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "event_workspaces_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "event_workspaces_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_exports: {
        Row: {
          attempts: number
          booking_id: string | null
          catalog_order_id: string | null
          created_at: string
          destination: string
          error: string | null
          event: string
          id: string
          payload: string
          payload_sha256: string
          provider: string
          receipt: Json
          response_code: number | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          booking_id?: string | null
          catalog_order_id?: string | null
          created_at?: string
          destination: string
          error?: string | null
          event: string
          id?: string
          payload: string
          payload_sha256: string
          provider?: string
          receipt: Json
          response_code?: number | null
          status: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          booking_id?: string | null
          catalog_order_id?: string | null
          created_at?: string
          destination?: string
          error?: string | null
          event?: string
          id?: string
          payload?: string
          payload_sha256?: string
          provider?: string
          receipt?: Json
          response_code?: number | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_exports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "expense_exports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_exports_catalog_order_id_fkey"
            columns: ["catalog_order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
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
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id", "venue_id"]
          },
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
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id"]
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
      invoice_number_series: {
        Row: {
          fiscal_year: string
          last_number: number
          venue_id: string
        }
        Insert: {
          fiscal_year: string
          last_number?: number
          venue_id: string
        }
        Update: {
          fiscal_year?: string
          last_number?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_number_series_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_escalation_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          created_at: string
          detail: Json
          escalation_id: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          detail?: Json
          escalation_id: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          detail?: Json
          escalation_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_escalation_events_escalation_id_fkey"
            columns: ["escalation_id"]
            isOneToOne: false
            referencedRelation: "negotiation_escalations"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_escalations: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_per_head_inr: number | null
          decision_note: string | null
          id: string
          party_size: number
          proposed_per_head_inr: number
          reason: string
          response_id: string
          rfp_id: string
          standard_per_head_inr: number | null
          status: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_per_head_inr?: number | null
          decision_note?: string | null
          id?: string
          party_size: number
          proposed_per_head_inr: number
          reason: string
          response_id: string
          rfp_id: string
          standard_per_head_inr?: number | null
          status?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_per_head_inr?: number | null
          decision_note?: string | null
          id?: string
          party_size?: number
          proposed_per_head_inr?: number
          reason?: string
          response_id?: string
          rfp_id?: string
          standard_per_head_inr?: number | null
          status?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_escalations_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "rfp_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_escalations_rfp_id_fkey"
            columns: ["rfp_id"]
            isOneToOne: false
            referencedRelation: "rfps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_escalations_venue_id_fkey"
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
          commission_rate: number
          contact_email: string | null
          created_at: string
          gstin: string | null
          id: string
          name: string
          razorpay_account_id: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          commission_rate?: number
          contact_email?: string | null
          created_at?: string
          gstin?: string | null
          id?: string
          name: string
          razorpay_account_id?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          commission_rate?: number
          contact_email?: string | null
          created_at?: string
          gstin?: string | null
          id?: string
          name?: string
          razorpay_account_id?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
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
          booking_id: string | null
          booking_invoice_id: string | null
          captured_at: string | null
          catalog_order_id: string | null
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
          booking_id?: string | null
          booking_invoice_id?: string | null
          captured_at?: string | null
          catalog_order_id?: string | null
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
          booking_id?: string | null
          booking_invoice_id?: string | null
          captured_at?: string | null
          catalog_order_id?: string | null
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
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_booking_invoice_id_fkey"
            columns: ["booking_invoice_id"]
            isOneToOne: false
            referencedRelation: "booking_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_catalog_order_id_fkey"
            columns: ["catalog_order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_guardrail_settings: {
        Row: {
          id: boolean
          settings: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      platform_users: {
        Row: {
          company_id: string | null
          corporate_role: Database["public"]["Enums"]["corporate_role"] | null
          created_at: string
          partner_id: string | null
          partner_role: Database["public"]["Enums"]["partner_role"] | null
          role: Database["public"]["Enums"]["portal_role"]
          user_id: string
          venue_id: string | null
        }
        Insert: {
          company_id?: string | null
          corporate_role?: Database["public"]["Enums"]["corporate_role"] | null
          created_at?: string
          partner_id?: string | null
          partner_role?: Database["public"]["Enums"]["partner_role"] | null
          role: Database["public"]["Enums"]["portal_role"]
          user_id: string
          venue_id?: string | null
        }
        Update: {
          company_id?: string | null
          corporate_role?: Database["public"]["Enums"]["corporate_role"] | null
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
      po_allocations: {
        Row: {
          amount_inr: number
          booking_id: string | null
          catalog_order_id: string | null
          created_at: string
          id: string
          over_balance: boolean
          po_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_inr: number
          booking_id?: string | null
          catalog_order_id?: string | null
          created_at?: string
          id?: string
          over_balance?: boolean
          po_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_inr?: number
          booking_id?: string | null
          catalog_order_id?: string | null
          created_at?: string
          id?: string
          over_balance?: boolean
          po_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_allocations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "po_allocations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_allocations_catalog_order_id_fkey"
            columns: ["catalog_order_id"]
            isOneToOne: true
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_allocations_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          amount_inr: number
          created_at: string
          created_by: string | null
          currency: string
          department_id: string | null
          description: string | null
          id: string
          po_number: string
          status: string
          tenant_id: string
          updated_at: string
          valid_from: string
          valid_to: string
        }
        Insert: {
          amount_inr: number
          created_at?: string
          created_by?: string | null
          currency?: string
          department_id?: string | null
          description?: string | null
          id?: string
          po_number: string
          status?: string
          tenant_id: string
          updated_at?: string
          valid_from: string
          valid_to: string
        }
        Update: {
          amount_inr?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          department_id?: string | null
          description?: string | null
          id?: string
          po_number?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
            foreignKeyName: "rfp_responses_menu_package_id_fkey"
            columns: ["menu_package_id"]
            isOneToOne: false
            referencedRelation: "venue_menu_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfp_responses_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "corporate_rate_cards"
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
          booking_id: string | null
          brief: string
          budget_per_head_inr: number | null
          city: string | null
          company_id: string
          created_at: string
          created_by: string | null
          dietary_tags: string[]
          event_date: string | null
          id: string
          origin: string
          party_size: number
          requirements: Json
          status: Database["public"]["Enums"]["rfp_status"]
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          brief: string
          budget_per_head_inr?: number | null
          city?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          dietary_tags?: string[]
          event_date?: string | null
          id?: string
          origin?: string
          party_size: number
          requirements: Json
          status?: Database["public"]["Enums"]["rfp_status"]
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          brief?: string
          budget_per_head_inr?: number | null
          city?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          dietary_tags?: string[]
          event_date?: string | null
          id?: string
          origin?: string
          party_size?: number
          requirements?: Json
          status?: Database["public"]["Enums"]["rfp_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfps_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "rfps_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tcs_entries: {
        Row: {
          catalog_order_id: string
          cgst_inr: number
          created_at: string
          id: string
          igst_inr: number
          kind: string
          partner_id: string
          place_of_supply: string
          rate_bps: number
          return_period: string
          sgst_inr: number
          supplier_gstin: string
          taxable_inr: number
        }
        Insert: {
          catalog_order_id: string
          cgst_inr?: number
          created_at?: string
          id?: string
          igst_inr?: number
          kind: string
          partner_id: string
          place_of_supply: string
          rate_bps: number
          return_period: string
          sgst_inr?: number
          supplier_gstin: string
          taxable_inr: number
        }
        Update: {
          catalog_order_id?: string
          cgst_inr?: number
          created_at?: string
          id?: string
          igst_inr?: number
          kind?: string
          partner_id?: string
          place_of_supply?: string
          rate_bps?: number
          return_period?: string
          sgst_inr?: number
          supplier_gstin?: string
          taxable_inr?: number
        }
        Relationships: [
          {
            foreignKeyName: "tcs_entries_catalog_order_id_fkey"
            columns: ["catalog_order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tcs_entries_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      team_budgets: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          department_id: string
          enforcement: string
          id: string
          limit_inr: number
          period: string
          period_end: string | null
          period_start: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          department_id: string
          enforcement?: string
          id?: string
          limit_inr: number
          period: string
          period_end?: string | null
          period_start: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          department_id?: string
          enforcement?: string
          id?: string
          limit_inr?: number
          period?: string
          period_end?: string | null
          period_start?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_budgets_department_fkey"
            columns: ["department_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "team_budgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          budget_limit_per_head_inr: number | null
          created_at: string
          cuisines: string[]
          dietary: string[]
          notes: string | null
          seating: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_limit_per_head_inr?: number | null
          created_at?: string
          cuisines?: string[]
          dietary?: string[]
          notes?: string | null
          seating?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_limit_per_head_inr?: number | null
          created_at?: string
          cuisines?: string[]
          dietary?: string[]
          notes?: string | null
          seating?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vendor_payouts: {
        Row: {
          catalog_order_id: string
          commission_gst_inr: number
          commission_inr: number
          commission_rate: number
          created_at: string
          gross_inr: number
          id: string
          last_error: string | null
          linked_account_id: string
          net_payout_inr: number
          partner_id: string
          payment_id: string
          provider_transfer_id: string | null
          released_at: string | null
          reversed_at: string | null
          settled_at: string | null
          status: string
          taxable_inr: number
          tcs_inr: number
          tcs_rate_bps: number
          updated_at: string
        }
        Insert: {
          catalog_order_id: string
          commission_gst_inr: number
          commission_inr: number
          commission_rate: number
          created_at?: string
          gross_inr: number
          id?: string
          last_error?: string | null
          linked_account_id: string
          net_payout_inr: number
          partner_id: string
          payment_id: string
          provider_transfer_id?: string | null
          released_at?: string | null
          reversed_at?: string | null
          settled_at?: string | null
          status?: string
          taxable_inr: number
          tcs_inr: number
          tcs_rate_bps: number
          updated_at?: string
        }
        Update: {
          catalog_order_id?: string
          commission_gst_inr?: number
          commission_inr?: number
          commission_rate?: number
          created_at?: string
          gross_inr?: number
          id?: string
          last_error?: string | null
          linked_account_id?: string
          net_payout_inr?: number
          partner_id?: string
          payment_id?: string
          provider_transfer_id?: string | null
          released_at?: string | null
          reversed_at?: string | null
          settled_at?: string | null
          status?: string
          taxable_inr?: number
          tcs_inr?: number
          tcs_rate_bps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payouts_catalog_order_id_fkey"
            columns: ["catalog_order_id"]
            isOneToOne: true
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payouts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payouts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_blocked_dates: {
        Row: {
          blocked_date: string
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          venue_id: string
        }
        Insert: {
          blocked_date: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          venue_id: string
        }
        Update: {
          blocked_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_blocked_dates_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
      venue_negotiation_rules: {
        Row: {
          alert_whatsapp: string | null
          auto_counter: boolean
          auto_decline_below_floor: boolean
          max_discount_pct: number | null
          min_spend_floor_inr: number | null
          updated_at: string
          updated_by: string | null
          venue_id: string
        }
        Insert: {
          alert_whatsapp?: string | null
          auto_counter?: boolean
          auto_decline_below_floor?: boolean
          max_discount_pct?: number | null
          min_spend_floor_inr?: number | null
          updated_at?: string
          updated_by?: string | null
          venue_id: string
        }
        Update: {
          alert_whatsapp?: string | null
          auto_counter?: boolean
          auto_decline_below_floor?: boolean
          max_discount_pct?: number | null
          min_spend_floor_inr?: number | null
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_negotiation_rules_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
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
      venue_pricing_rules: {
        Row: {
          deposit_pct: number | null
          guest_tiers: Json
          lock_min_spend: boolean
          locked_package_ids: string[]
          rate_multipliers: Json
          updated_at: string
          updated_by: string | null
          venue_id: string
        }
        Insert: {
          deposit_pct?: number | null
          guest_tiers?: Json
          lock_min_spend?: boolean
          locked_package_ids?: string[]
          rate_multipliers?: Json
          updated_at?: string
          updated_by?: string | null
          venue_id: string
        }
        Update: {
          deposit_pct?: number | null
          guest_tiers?: Json
          lock_min_spend?: boolean
          locked_package_ids?: string[]
          rate_multipliers?: Json
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_pricing_rules_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string
          cancellation_terms: Json
          capacity_max: number
          city: string
          commission_rate: number
          created_at: string
          entertainment: string[]
          gstin: string
          id: string
          is_active: boolean
          latitude: number | null
          longitude: number | null
          min_spend_inr: number
          min_spend_per_head_inr: number
          name: string
          neighborhood: string
          pdr_available: boolean
          private_suites: Json
          seating_layouts: Json
          serves_alcohol: boolean
          state_code: string | null
          updated_at: string
        }
        Insert: {
          address: string
          cancellation_terms?: Json
          capacity_max: number
          city: string
          commission_rate?: number
          created_at?: string
          entertainment?: string[]
          gstin: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          min_spend_inr?: number
          min_spend_per_head_inr?: number
          name: string
          neighborhood: string
          pdr_available?: boolean
          private_suites?: Json
          seating_layouts?: Json
          serves_alcohol?: boolean
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          cancellation_terms?: Json
          capacity_max?: number
          city?: string
          commission_rate?: number
          created_at?: string
          entertainment?: string[]
          gstin?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          min_spend_inr?: number
          min_spend_per_head_inr?: number
          name?: string
          neighborhood?: string
          pdr_available?: boolean
          private_suites?: Json
          seating_layouts?: Json
          serves_alcohol?: boolean
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
      virtual_cards: {
        Row: {
          amount_limit_inr: number
          booking_id: string
          card_token: string
          created_at: string
          currency: string
          expense_error: string | null
          expense_sync_status: string
          expense_synced_at: string | null
          expires_at: string
          id: string
          issued_by: string | null
          last4: string
          provider: string
          provider_card_id: string
          single_use: boolean
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_limit_inr: number
          booking_id: string
          card_token: string
          created_at?: string
          currency?: string
          expense_error?: string | null
          expense_sync_status?: string
          expense_synced_at?: string | null
          expires_at: string
          id?: string
          issued_by?: string | null
          last4: string
          provider: string
          provider_card_id: string
          single_use?: boolean
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_limit_inr?: number
          booking_id?: string
          card_token?: string
          created_at?: string
          currency?: string
          expense_error?: string | null
          expense_sync_status?: string
          expense_synced_at?: string | null
          expires_at?: string
          id?: string
          issued_by?: string | null
          last4?: string
          provider?: string
          provider_card_id?: string
          single_use?: boolean
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "virtual_cards_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "booking_tax_breakdown"
            referencedColumns: ["booking_id", "company_id"]
          },
          {
            foreignKeyName: "virtual_cards_booking_fkey"
            columns: ["booking_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "virtual_cards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
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
      tcs_gstr8_summary: {
        Row: {
          cgst_inr: number | null
          gross_supplies_inr: number | null
          igst_inr: number | null
          net_taxable_inr: number | null
          place_of_supply: string | null
          return_period: string | null
          sgst_inr: number | null
          supplier_gstin: string | null
          supplies_returned_inr: number | null
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
      activate_prompt_version: {
        Args: { p_id: string; p_user: string }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          prompt_key: string
          status: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "agent_prompt_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      budget_hold_status_for: {
        Args: { subject_status: string }
        Returns: string
      }
      can_join_event_channel: { Args: { topic: string }; Returns: boolean }
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
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      escalate_booking_approval: {
        Args: { p_approval_id: string; p_reason?: string }
        Returns: string
      }
      escalate_overdue_approvals: { Args: never; Returns: number }
      gstin_checksum: { Args: { p_first14: string }; Returns: string }
      indian_fiscal_year: { Args: { d: string }; Returns: string }
      is_platform_admin: { Args: never; Returns: boolean }
      is_valid_gstin: { Args: { p_gstin: string }; Returns: boolean }
      match_booking_memories: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          booking_id: string
          created_at: string
          id: string
          kind: string
          similarity: number
          summary: string
        }[]
      }
      replace_approval_chain: {
        Args: { p_approvers: string[]; p_tenant_id: string }
        Returns: undefined
      }
      rfp_company_id: { Args: { p_rfp_id: string }; Returns: string }
      rfp_sent_to_current_venue: {
        Args: { p_rfp_id: string }
        Returns: boolean
      }
    }
    Enums: {
      approval_status: "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED"
      booking_status:
        | "PENDING_APPROVAL"
        | "PENDING"
        | "CONFIRMED"
        | "COMPLETED"
        | "SETTLED"
        | "CANCELLED"
      corporate_role: "ORGANIZER" | "APPROVER" | "FINANCE_VIEWER"
      gst_type: "CGST_SGST" | "IGST"
      hold_status: "ACTIVE" | "RELEASED" | "CONVERTED"
      onboarding_status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"
      partner_role: "OWNER" | "MANAGER" | "STAFF"
      payment_provider: "razorpay" | "stripe"
      payment_status:
        | "created"
        | "authorized"
        | "captured"
        | "voided"
        | "failed"
        | "refunded"
      portal_role: "ADMIN" | "CLIENT" | "PROPERTY" | "PARTNER"
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
      approval_status: ["PENDING", "APPROVED", "REJECTED", "ESCALATED"],
      booking_status: [
        "PENDING_APPROVAL",
        "PENDING",
        "CONFIRMED",
        "COMPLETED",
        "SETTLED",
        "CANCELLED",
      ],
      corporate_role: ["ORGANIZER", "APPROVER", "FINANCE_VIEWER"],
      gst_type: ["CGST_SGST", "IGST"],
      hold_status: ["ACTIVE", "RELEASED", "CONVERTED"],
      onboarding_status: ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"],
      partner_role: ["OWNER", "MANAGER", "STAFF"],
      payment_provider: ["razorpay", "stripe"],
      payment_status: [
        "created",
        "authorized",
        "captured",
        "voided",
        "failed",
        "refunded",
      ],
      portal_role: ["ADMIN", "CLIENT", "PROPERTY", "PARTNER"],
      rfp_response_source: ["instant", "venue"],
      rfp_response_status: ["quoted", "countered", "declined", "no_fit"],
      rfp_status: ["open", "awarded", "closed"],
    },
  },
} as const
