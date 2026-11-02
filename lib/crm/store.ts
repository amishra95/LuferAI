import "server-only";

import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DealInput, DealStage } from "./deals";

/**
 * crm_deals and bookings.crm_deal_id (supabase/migrations/20261111000000_crm_deals.sql).
 * Supabase only: in Redis/mock mode there are no deals and writes refuse.
 */

export interface CrmDeal {
  id: string;
  company_id: string;
  provider: string;
  external_id: string;
  name: string;
  account_name: string | null;
  amount_inr: number;
  stage: DealStage;
  closed_on: string | null;
  owner_email: string | null;
  updated_at: string;
}

export const dealsAvailable = () => dataSource() === "supabase";

export async function listDeals(companyId: string): Promise<CrmDeal[]> {
  if (!dealsAvailable()) return [];
  const { data, error } = await createAdminClient().from("crm_deals").select("*").eq("company_id", companyId).order("name");
  if (error) throw error;
  return data.map((d) => ({ ...d, amount_inr: Number(d.amount_inr), stage: d.stage as DealStage }));
}

/** Inserts new deals and updates ones already imported (same provider + CRM id). Returns how many rows were written. */
export async function upsertDeals(companyId: string, deals: readonly DealInput[]): Promise<number> {
  if (!dealsAvailable()) throw new Error("Deals need the Supabase database.");
  if (deals.length === 0) return 0;
  const rows = deals.map((d) => ({ ...d, company_id: companyId }));
  let written = 0;
  // PostgREST caps request size; 500 rows a batch stays well inside it.
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await createAdminClient()
      .from("crm_deals")
      .upsert(rows.slice(i, i + 500), { onConflict: "company_id,provider,external_id" })
      .select("id");
    if (error) throw error;
    written += data.length;
  }
  return written;
}

/** Links a booking to one of its company's deals, or unlinks it (null). The DB trigger also refuses another company's deal. */
export async function setBookingDeal(bookingId: string, companyId: string, dealId: string | null): Promise<void> {
  if (!dealsAvailable()) throw new Error("Deals need the Supabase database.");
  const { data, error } = await createAdminClient().from("bookings").update({ crm_deal_id: dealId }).eq("id", bookingId).eq("company_id", companyId).select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error(`Booking ${bookingId} not found for company ${companyId}`);
}
