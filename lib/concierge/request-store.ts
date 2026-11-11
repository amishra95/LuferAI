import "server-only";

import { conciergeAlertText, WITHDRAWN_NOTE, type NewConciergeRequest, type RequestUpdate } from "@/lib/concierge/requests";
import { sendTelegram } from "@/lib/services/telegram";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ConciergeRequest } from "@/lib/supabase/database.types";

/** concierge_requests (migration 20261114000000). Service role: callers check who may read or write. */

export async function createConciergeRequest(r: NewConciergeRequest): Promise<ConciergeRequest> {
  const { data, error } = await createAdminClient()
    .from("concierge_requests")
    .insert({
      company_id: r.companyId,
      requested_by: r.requestedBy,
      requester_email: r.requesterEmail,
      kind: r.kind,
      partner_venue_id: r.partnerVenueId ?? null,
      venue_name: r.venueName ?? null,
      event_date: r.eventDate ?? null,
      guests: r.guests ?? null,
      per_head_inr: r.perHeadInr ?? null,
      details: r.details ?? null,
      rfp_id: r.rfpId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** A company's requests, newest first. */
export async function listCompanyRequests(companyId: string, limit = 10): Promise<ConciergeRequest[]> {
  const { data, error } = await createAdminClient()
    .from("concierge_requests")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type AdminRequest = ConciergeRequest & { company_name: string | null };

/** Every request for the admin queue: open ones first (oldest waiting longest on top), then the rest, newest first. */
export async function listAllRequests(limit = 200): Promise<AdminRequest[]> {
  const db = createAdminClient();
  const [{ data, error }, { data: companies, error: companyError }] = await Promise.all([
    db.from("concierge_requests").select("*").order("created_at", { ascending: false }).limit(limit),
    db.from("companies").select("id, legal_name"),
  ]);
  if (error) throw error;
  if (companyError) throw companyError;
  const names = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));
  const rows = (data ?? []).map((r) => ({ ...r, company_name: r.company_id ? (names.get(r.company_id) ?? null) : null }));
  const open = rows.filter((r) => r.status === "new" || r.status === "working").reverse();
  return [...open, ...rows.filter((r) => r.status !== "new" && r.status !== "working")];
}

export async function updateConciergeRequest(u: RequestUpdate): Promise<boolean> {
  const { data, error } = await createAdminClient().from("concierge_requests").update({ status: u.status, note: u.note }).eq("id", u.id).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function getConciergeRequest(id: string): Promise<ConciergeRequest | null> {
  const { data, error } = await createAdminClient().from("concierge_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Closes a request the company withdrew, if it's still open (false: already booked or closed). */
export async function withdrawConciergeRequest(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("concierge_requests")
    .update({ status: "closed", note: WITHDRAWN_NOTE })
    .eq("id", id)
    .in("status", ["new", "working", "options_sent"])
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** The instant alert for a new request. Never throws. */
export async function alertConcierge(r: NewConciergeRequest & { companyName: string }): Promise<void> {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://lufer.app").replace(/\/$/, "");
  const sent = await sendTelegram(conciergeAlertText(r, `${site}/admin/requests`));
  if (sent.status === "failed") console.error("concierge: Telegram alert failed", sent.error);
}
