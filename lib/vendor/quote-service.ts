import "server-only";

import { after } from "next/server";

import { sendWhatsAppMessage, whatsAppProvider } from "@/lib/agent/connectors/whatsapp";
import { venueAlertNumber } from "@/lib/escalations/store";
import { GuardrailError, listVenuePackages, respondToRfp } from "@/lib/rfp/service";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import type { Rfp, RfpResponse } from "@/lib/supabase/database.types";
import { formatINR } from "@/lib/utils";
import { splitQuoteNotes, type InclusionId, type QuoteSubmission } from "@/lib/vendor/quote-form";
import { signQuoteToken, verifyQuoteToken } from "@/lib/vendor/quote-link";

/**
 * The venue side of a quote link (app/(vendor)/quote/[token]): what the RFP
 * asks for, the venue's current answer, and the counter or decline it sends
 * back, through the same respondToRfp (and guardrails) as the property portal.
 * RFPs live in Supabase only, so links need it; VENDOR_LINK_SECRET turns them on.
 */

export const vendorLinkSecret = () => (process.env.VENDOR_LINK_SECRET ?? "").trim();

/** Who answered, for the escalation audit trail: the venue, through its link. */
const LINK_ACTOR = { id: null, role: "venue_link" };

/** The absolute link for one venue's response, or null while links are off. */
export function vendorQuoteUrl(responseId: string, venueId: string): string | null {
  const secret = vendorLinkSecret();
  if (!secret) return null;
  return `${siteUrl("http://localhost:3000")}/quote/${signQuoteToken({ responseId, venueId }, secret)}`;
}

export interface VendorQuoteView {
  responseId: string;
  venueId: string;
  venueName: string;
  companyName: string;
  rfp: Pick<Rfp, "brief" | "party_size" | "event_date" | "event_start_time" | "event_type" | "budget_per_head_inr" | "dietary_tags" | "status" | "city">;
  /** The venue's current answer: the instant quote, its last counter, or a decline. */
  current: { status: RfpResponse["status"]; perHeadInr: number | null; menuPackageId: string | null; inclusions: InclusionId[]; notes: string };
  packages: { id: string; name: string; perHeadInr: number; description: string | null; dietaryTags: string[] }[];
  /** Unix seconds. */
  expiresAt: number;
}

export type VendorQuoteLoad =
  | { status: "open" | "closed"; view: VendorQuoteView }
  /** Not ours, tampered with, or for a response that no longer exists. */
  | { status: "invalid" }
  | { status: "expired" }
  /** Links are off (no secret) or there's no database to read RFPs from. */
  | { status: "unavailable" };

/** Reads the RFP a token opens. Never trusts anything but the token's signed scope. */
export async function loadVendorQuote(token: string): Promise<VendorQuoteLoad> {
  const check = verifyQuoteToken(token, vendorLinkSecret());
  if (!check.ok) return check.reason === "expired" ? { status: "expired" } : check.reason === "unconfigured" ? { status: "unavailable" } : { status: "invalid" };
  if (!isSupabaseConfigured()) return { status: "unavailable" };

  const { data, error } = await createAdminClient()
    .from("rfp_responses")
    .select(
      "id, venue_id, status, per_head_inr, menu_package_id, notes, venue:venues!inner(name), rfp:rfps!inner(brief, party_size, event_date, event_start_time, event_type, budget_per_head_inr, dietary_tags, status, city, company:companies(legal_name))"
    )
    .eq("id", check.responseId)
    .eq("venue_id", check.venueId) // the token's venue: a link never opens another venue's response
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: "invalid" };

  type Row = typeof data & { venue: { name: string }; rfp: VendorQuoteView["rfp"] & { company: { legal_name: string } | null } };
  const row = data as Row;
  const packages = (await listVenuePackages(check.venueId)).filter((p) => p.is_active);
  const { company, ...rfp } = row.rfp;
  const saved = splitQuoteNotes(row.notes);
  const view: VendorQuoteView = {
    responseId: row.id,
    venueId: row.venue_id,
    venueName: row.venue.name,
    companyName: company?.legal_name ?? "A corporate client",
    rfp: { ...rfp, budget_per_head_inr: rfp.budget_per_head_inr != null ? Number(rfp.budget_per_head_inr) : null },
    current: { status: row.status, perHeadInr: row.per_head_inr != null ? Number(row.per_head_inr) : null, menuPackageId: row.menu_package_id, ...saved },
    packages: packages.map((p) => ({ id: p.id, name: p.name, perHeadInr: p.per_head_inr, description: p.description, dietaryTags: p.dietary_tags ?? [] })),
    expiresAt: check.expiresAt,
  };
  return { status: rfp.status === "open" ? "open" : "closed", view };
}

/**
 * Sends the venue's counter or decline. Errors are messages for the venue
 * manager: the venue's own guardrails, a closed RFP, an expired link.
 */
export async function submitVendorQuote(token: string, submission: QuoteSubmission): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = verifyQuoteToken(token, vendorLinkSecret());
  if (!check.ok) return { ok: false, error: check.reason === "expired" ? "This link has expired. Ask the client for a new one." : "This link isn't valid." };
  try {
    await respondToRfp({
      responseId: check.responseId,
      venueId: check.venueId,
      decline: submission.decline,
      ...(submission.decline ? {} : { perHeadInr: submission.perHeadInr, menuPackageId: submission.menuPackageId }),
      notes: submission.notes,
      actor: LINK_ACTOR,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof GuardrailError) return { ok: false, error: err.message };
    const message = err instanceof Error ? err.message : "";
    // respondToRfp's own refusals are written for people.
    if (message === "This RFP is closed" || message === "RFP not found" || message === "Unknown menu package" || message === "Enter a per-head price") return { ok: false, error: `${message}.` };
    console.error("vendor: quote submit failed", err);
    return { ok: false, error: "Your quote couldn't be sent. Please try again." };
  }
}

// ----------------------------------------------------------------------------
// Sending links
// ----------------------------------------------------------------------------

/** The WhatsApp a venue gets with its link. */
export function quoteLinkMessage(r: { companyName: string; partySize: number; eventDate: string | null; perHeadInr: number | null; url: string }): string {
  const when = r.eventDate ? ` on ${r.eventDate}` : "";
  const price = r.perHeadInr != null ? `We've sent them your standard ${formatINR(r.perHeadInr)} a head. ` : "";
  return `New event request from ${r.companyName}: ${r.partySize} guests${when}. ${price}Adjust your price and inclusions, or decline, in 30 seconds (no login): ${r.url}`;
}

/**
 * Sends each venue that got an RFP its quote link, on the WhatsApp number the
 * host set for alerts (the escalation alert number). Meta only delivers
 * free-form text inside the 24-hour window, as for escalation alerts. Runs
 * after the response; never throws.
 */
export function sendQuoteLinks(rfp: { companyName: string; partySize: number; eventDate: string | null }, responses: { id: string; venue_id: string; per_head_inr?: number | null }[]): void {
  if (!vendorLinkSecret() || !whatsAppProvider() || responses.length === 0) return;
  const work = Promise.all(
    responses.map(async (r) => {
      try {
        const to = await venueAlertNumber(r.venue_id);
        const url = vendorQuoteUrl(r.id, r.venue_id);
        if (!to || !url) return;
        await sendWhatsAppMessage(to, quoteLinkMessage({ ...rfp, perHeadInr: r.per_head_inr ?? null, url }));
      } catch (err) {
        console.error(`vendor: quote link for ${r.venue_id} not sent`, err);
      }
    })
  );
  try {
    after(work);
  } catch {
    // Outside a request (tests, scripts): the promise still runs.
  }
}
