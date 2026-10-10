import "server-only";

import { PARTNER_ROLES, wouldOrphanPartner, type PartnerRole } from "@/lib/auth/partner-rbac";
import { dataSource } from "@/lib/data";
import { todayInIndia } from "@/lib/gst-engine";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Partner, PartnerAuditEntry, PartnerRateCard, PartnerVenue } from "@/lib/supabase/database.types";
import { fromPerHead, overlappingRates, type ListingInput, type RateCardInput } from "./validation";

/**
 * Partner extranet data access. Every function takes the partnerId that
 * lib/auth/session.ts → requirePartner() resolved for the caller and scopes
 * its queries to it; permission checks happen in the server actions.
 *
 * Writes go through the service role (like the rest of the app), so they
 * aren't limited by RLS; the RLS policies in the migration guard direct API use.
 * Partners need Supabase (sign-in does), so there is no mock-store variant.
 */

const db = () => createAdminClient();

/** A user-facing failure (bad input, conflict); other errors are bugs and are logged. */
export class PartnerError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "PartnerError";
    this.field = field;
  }
}

// ----------------------------------------------------------------------------
// Partners
// ----------------------------------------------------------------------------

export async function listPartners(): Promise<Partner[]> {
  if (dataSource() !== "supabase") return [];
  const { data, error } = await db().from("partners").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function getPartner(partnerId: string): Promise<Partner | null> {
  if (dataSource() !== "supabase") return null;
  const { data, error } = await db().from("partners").select("*").eq("id", partnerId).maybeSingle();
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------------------
// Audit log
// ----------------------------------------------------------------------------

export async function recordAudit(entry: {
  partnerId: string;
  actorId: string;
  action: string;
  entity: "listing" | "rate_card" | "member" | "partner" | "catalog_item" | "catalog_order";
  entityId?: string | null;
  detail?: Record<string, unknown>;
}) {
  const { error } = await db()
    .from("partner_audit_log")
    .insert({
      partner_id: entry.partnerId,
      actor_id: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      detail: (entry.detail ?? {}) as Json,
    });
  // The change itself succeeded; a missing audit row is logged, not surfaced.
  if (error) console.error("partner: audit insert failed", { action: entry.action, error: error.message });
}

export async function listAudit(partnerId: string, limit = 50): Promise<(PartnerAuditEntry & { actor: string })[]> {
  const { data, error } = await db()
    .from("partner_audit_log")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const emails = await emailsFor(data.map((d) => d.actor_id).filter((id): id is string => Boolean(id)));
  return data.map((d) => ({ ...d, actor: (d.actor_id && emails.get(d.actor_id)) || "Lufer.ai admin" }));
}

// ----------------------------------------------------------------------------
// Listings
// ----------------------------------------------------------------------------

export async function listPartnerVenues(partnerId: string): Promise<PartnerVenue[]> {
  const { data, error } = await db().from("partner_venues").select("*").eq("partner_id", partnerId).order("name");
  if (error) throw error;
  return data;
}

function listingError(error: { code?: string; message: string }): never {
  if (error.code === "23505") throw new PartnerError("You already have a listing with this reference.", "ref");
  throw error;
}

export async function createListing(partnerId: string, input: ListingInput): Promise<PartnerVenue> {
  const { data, error } = await db()
    .from("partner_venues")
    .insert({ ...input, partner_id: partnerId })
    .select("*")
    .single();
  if (error) listingError(error);
  return data;
}

export async function updateListing(partnerId: string, listingId: string, input: ListingInput): Promise<PartnerVenue> {
  const { data, error } = await db()
    .from("partner_venues")
    .update(input)
    .eq("id", listingId)
    .eq("partner_id", partnerId)
    .select("*")
    .maybeSingle();
  if (error) listingError(error);
  if (!data) throw new PartnerError("That listing wasn't found.");
  return data;
}

export async function setListingStatus(partnerId: string, listingId: string, status: "active" | "paused"): Promise<PartnerVenue> {
  const { data, error } = await db()
    .from("partner_venues")
    .update({ status })
    .eq("id", listingId)
    .eq("partner_id", partnerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PartnerError("That listing wasn't found.");
  return data;
}

export async function deleteListing(partnerId: string, listingId: string): Promise<PartnerVenue> {
  const { data, error } = await db().from("partner_venues").delete().eq("id", listingId).eq("partner_id", partnerId).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new PartnerError("That listing wasn't found.");
  return data;
}

// ----------------------------------------------------------------------------
// Rate cards
// ----------------------------------------------------------------------------

export async function listPartnerRateCards(partnerId: string): Promise<PartnerRateCard[]> {
  const { data, error } = await db()
    .from("partner_rate_cards")
    .select("*")
    .eq("partner_id", partnerId)
    .order("valid_from", { ascending: false });
  if (error) throw error;
  return data.map((r) => ({ ...r, per_head_inr: Number(r.per_head_inr) }));
}

/** Creates (no id) or updates a rate card after checking it doesn't overlap another in its bracket. */
export async function saveRateCard(partnerId: string, actorId: string, input: RateCardInput, id?: string): Promise<PartnerRateCard> {
  const [venues, existing] = await Promise.all([listPartnerVenues(partnerId), listPartnerRateCards(partnerId)]);
  if (!venues.some((v) => v.id === input.partner_venue_id)) throw new PartnerError("Choose one of your listings.", "partner_venue_id");
  if (id && !existing.some((r) => r.id === id)) throw new PartnerError("That rate card wasn't found.");

  const clash = overlappingRates(existing, { ...input, id });
  if (clash.length) {
    const c = clash[0];
    throw new PartnerError(
      `Overlaps "${c.label}" (${c.valid_from} – ${c.valid_to ?? "open-ended"}) for groups of ${c.min_guests}+. End that rate first or pick other dates.`,
      "valid_from"
    );
  }

  const row = { ...input, partner_id: partnerId, updated_by: actorId };
  const query = id
    ? db().from("partner_rate_cards").update(row).eq("id", id).eq("partner_id", partnerId)
    : db().from("partner_rate_cards").insert(row);
  const { data, error } = await query.select("*").single();
  // 23P01: the exclusion constraint caught a concurrent overlapping save.
  if (error?.code === "23P01") throw new PartnerError("Another rate for these dates was just saved. Reload and try again.", "valid_from");
  if (error) throw error;
  return { ...data, per_head_inr: Number(data.per_head_inr) };
}

export async function deleteRateCard(partnerId: string, rateId: string): Promise<PartnerRateCard> {
  const { data, error } = await db().from("partner_rate_cards").delete().eq("id", rateId).eq("partner_id", partnerId).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new PartnerError("That rate card wasn't found.");
  return data;
}

// ----------------------------------------------------------------------------
// Team
// ----------------------------------------------------------------------------

export interface PartnerMember {
  userId: string;
  email: string;
  partnerRole: PartnerRole;
  joinedAt: string;
}

async function emailsFor(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const wanted = new Set(userIds);
  const out = new Map<string, string>();
  // Admin API pages through all users; partner teams are small, so stop once found.
  for (let page = 1; page <= 20 && out.size < wanted.size; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (wanted.has(u.id)) out.set(u.id, u.email ?? u.id);
    if (data.users.length < 1000) break;
  }
  return out;
}

export async function listPartnerMembers(partnerId: string): Promise<PartnerMember[]> {
  const { data, error } = await db()
    .from("platform_users")
    .select("user_id, partner_role, created_at")
    .eq("role", "PARTNER")
    .eq("partner_id", partnerId);
  if (error) throw error;
  const emails = await emailsFor(data.map((d) => d.user_id));
  return data
    .map((d) => ({ userId: d.user_id, email: emails.get(d.user_id) ?? d.user_id, partnerRole: d.partner_role as PartnerRole, joinedAt: d.created_at }))
    .sort((a, b) => PARTNER_ROLES.indexOf(a.partnerRole) - PARTNER_ROLES.indexOf(b.partnerRole) || a.email.localeCompare(b.email));
}

/** Change a member's role (nextRole) or remove them (null). Refuses to leave the partner without an owner. */
export async function changeMember(partnerId: string, userId: string, nextRole: PartnerRole | null): Promise<PartnerMember> {
  const members = await listPartnerMembers(partnerId);
  const member = members.find((m) => m.userId === userId);
  if (!member) throw new PartnerError("That person isn't on this partner's team.");
  if (wouldOrphanPartner(members, { userId, nextRole })) {
    throw new PartnerError("A partner needs at least one Owner. Make someone else an Owner first.");
  }
  const query = nextRole
    ? db().from("platform_users").update({ partner_role: nextRole }).eq("user_id", userId).eq("partner_id", partnerId)
    : db().from("platform_users").delete().eq("user_id", userId).eq("partner_id", partnerId);
  const { error } = await query;
  if (error) throw error;
  return member;
}

/**
 * Adds someone to the partner's team: emails an invite to new users; existing
 * users without a portal membership are added directly (they sign in as usual).
 */
export async function inviteMember(partnerId: string, email: string, partnerRole: PartnerRole, redirectTo: string): Promise<{ userId: string; invited: boolean }> {
  const supabase = db();
  let userId: string | null = null;
  let invited = false;

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error) {
    userId = data.user.id;
    invited = true;
  } else if (error.code === "email_exists" || error.status === 422) {
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data: list, error: listError } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (listError) throw listError;
      userId = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
      if (list.users.length < 1000) break;
    }
  } else {
    throw error;
  }
  if (!userId) throw new PartnerError("Couldn't invite that address.", "email");

  const { data: existing, error: lookupError } = await supabase.from("platform_users").select("role, partner_id").eq("user_id", userId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    throw new PartnerError(
      existing.partner_id === partnerId ? "They're already on your team." : "That person already has a Lufer.ai account for another organisation.",
      "email"
    );
  }

  const { error: insertError } = await supabase
    .from("platform_users")
    .insert({ user_id: userId, role: "PARTNER", partner_id: partnerId, partner_role: partnerRole });
  if (insertError) throw insertError;
  return { userId, invited };
}

// ----------------------------------------------------------------------------
// Directory feed
// ----------------------------------------------------------------------------

export interface ExtranetListing {
  id: string;
  ref: string;
  partnerName: string;
  name: string;
  area: string;
  city: string;
  address: string;
  capacity: number;
  minSpendInr: number;
  privateDining: boolean;
  /** Cheapest per-head rate active today, if the partner published one. */
  fromPerHeadInr: number | null;
}

/** Active listings of active partners, for the venue directory and the concierge's searchVenues tool. */
export async function listExtranetListings(): Promise<ExtranetListing[]> {
  if (dataSource() !== "supabase") return [];
  const supabase = db();
  const [{ data: venues, error }, { data: rates, error: ratesError }] = await Promise.all([
    supabase.from("partner_venues").select("*, partner:partners!inner(name, status)").eq("status", "active").eq("partner.status", "active"),
    supabase.from("partner_rate_cards").select("id, partner_venue_id, per_head_inr, min_guests, valid_from, valid_to"),
  ]);
  if (error) throw error;
  if (ratesError) throw ratesError;
  const today = todayInIndia();
  const windows = rates.map((r) => ({ ...r, per_head_inr: Number(r.per_head_inr) }));
  return venues.map((v) => ({
    id: v.id,
    ref: v.ref,
    partnerName: (v.partner as { name: string }).name,
    name: v.name,
    area: v.area,
    city: v.city,
    address: v.address,
    capacity: v.capacity,
    minSpendInr: Number(v.min_spend_inr),
    privateDining: v.private_dining,
    fromPerHeadInr: fromPerHead(windows, v.id, today),
  }));
}
