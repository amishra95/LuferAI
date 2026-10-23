import "server-only";

import { dataSource, listVenues } from "@/lib/data";
import { mutateDb, readDb } from "@/lib/data/local-store";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.generated";
import type { Venue, VenueInquiry } from "@/lib/supabase/database.types";
import { isInquiryStatus, type InquiryMessage, type InquiryStatus, type LeadDetails, type NetworkVenue } from "@/lib/venues/inquiry";

/**
 * venue_inquiries (migration 20261104000000): Supabase when configured, the
 * local store otherwise, like lib/data. Callers scope by venue: a token or an
 * id only ever reaches inquiries of the venue it's used with.
 */
const local = () => dataSource() !== "supabase";

export type InquiryRow = Omit<VenueInquiry, "messages" | "status" | "budget_per_head_inr"> & {
  messages: InquiryMessage[];
  status: InquiryStatus;
  budget_per_head_inr: number | null;
};

const toRow = (r: VenueInquiry): InquiryRow => ({
  ...r,
  status: isInquiryStatus(r.status) ? r.status : "open",
  budget_per_head_inr: r.budget_per_head_inr != null ? Number(r.budget_per_head_inr) : null,
  messages: Array.isArray(r.messages) ? (r.messages as unknown as InquiryMessage[]) : [],
});

export async function findInquiry(venueId: string, tokenSha256: string): Promise<InquiryRow | null> {
  if (local()) {
    const r = (await readDb()).venueInquiries.find((i) => i.venue_id === venueId && i.token_sha256 === tokenSha256);
    return r ? toRow(r) : null;
  }
  const { data, error } = await createAdminClient().from("venue_inquiries").select("*").eq("venue_id", venueId).eq("token_sha256", tokenSha256).maybeSingle();
  if (error) throw error;
  return data ? toRow(data) : null;
}

export type InquiryWrite = LeadDetails & {
  status: InquiryStatus;
  date_available: boolean | null;
  referred_venue_ids: string[];
  messages: InquiryMessage[];
  qualified_at: string | null;
};

/** Creates the conversation on its first message, or saves the next turn. */
export async function saveInquiry(venueId: string, tokenSha256: string, id: string | null, w: InquiryWrite): Promise<InquiryRow> {
  const now = new Date().toISOString();
  if (local()) {
    let out!: VenueInquiry;
    await mutateDb((db) => {
      const existing = id ? db.venueInquiries.find((i) => i.id === id && i.venue_id === venueId) : undefined;
      const values = { ...w, messages: w.messages as unknown as Json, last_message_at: now, updated_at: now };
      if (existing) {
        Object.assign(existing, values);
        out = { ...existing };
      } else {
        out = { ...values, id: crypto.randomUUID(), venue_id: venueId, token_sha256: tokenSha256, notes: null, created_at: now };
        db.venueInquiries.push(out);
      }
    });
    return toRow(out);
  }
  const db = createAdminClient();
  const values = { ...w, messages: w.messages as unknown as Json, last_message_at: now };
  const { data, error } = id
    ? await db.from("venue_inquiries").update(values).eq("id", id).eq("venue_id", venueId).select("*").single()
    : await db.from("venue_inquiries").insert({ ...values, venue_id: venueId, token_sha256: tokenSha256 }).select("*").single();
  if (error) throw error;
  return toRow(data);
}

/** A venue's inquiries, latest conversation first. */
export async function listInquiries(venueId: string, limit = 100): Promise<InquiryRow[]> {
  if (local()) {
    return (await readDb()).venueInquiries
      .filter((i) => i.venue_id === venueId)
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
      .slice(0, limit)
      .map(toRow);
  }
  const { data, error } = await createAdminClient().from("venue_inquiries").select("*").eq("venue_id", venueId).order("last_message_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data.map(toRow);
}

/** The venue's own call: converted, closed, or back to open/qualified. Scoped to its venue. */
export async function setInquiryStatus(venueId: string, id: string, status: InquiryStatus, notes?: string | null): Promise<void> {
  const patch = { status, ...(notes !== undefined && { notes: notes?.trim().slice(0, 1000) || null }) };
  if (local()) {
    await mutateDb((db) => {
      const i = db.venueInquiries.find((x) => x.id === id && x.venue_id === venueId);
      if (!i) throw new Error("Inquiry not found");
      Object.assign(i, patch, { updated_at: new Date().toISOString() });
    });
    return;
  }
  const { data, error } = await createAdminClient().from("venue_inquiries").update(patch).eq("id", id).eq("venue_id", venueId).select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("Inquiry not found");
}

export interface VenueFacts {
  venue: Venue;
  packages: { name: string; per_head_inr: number; description: string | null; dietary_tags: string[] }[];
}

/** An active venue and its active menu packages (cheapest first), for the agent's answers. */
export async function venueFacts(venueId: string): Promise<VenueFacts | null> {
  const venue = (await listVenues()).find((v) => v.id === venueId);
  if (!venue) return null;
  if (local()) return { venue, packages: [] };
  const { data, error } = await createAdminClient()
    .from("venue_menu_packages")
    .select("name, per_head_inr, description, dietary_tags")
    .eq("venue_id", venueId)
    .eq("is_active", true)
    .order("per_head_inr");
  if (error) throw error;
  return { venue, packages: data.map((p) => ({ ...p, per_head_inr: Number(p.per_head_inr), dietary_tags: p.dietary_tags ?? [] })) };
}

/** Every active venue, with its cheapest package price, for suggesting alternatives. */
export async function networkVenues(): Promise<NetworkVenue[]> {
  const venues = await listVenues();
  const from = new Map<string, number>();
  if (!local()) {
    const { data, error } = await createAdminClient().from("venue_menu_packages").select("venue_id, per_head_inr").eq("is_active", true);
    if (error) throw error;
    for (const p of data) {
      const v = Number(p.per_head_inr);
      if (!from.has(p.venue_id) || v < from.get(p.venue_id)!) from.set(p.venue_id, v);
    }
  }
  return venues.map((v) => ({
    id: v.id,
    name: v.name,
    neighborhood: v.neighborhood,
    city: v.city,
    capacity_max: v.capacity_max,
    latitude: v.latitude != null ? Number(v.latitude) : null,
    longitude: v.longitude != null ? Number(v.longitude) : null,
    from_per_head_inr: from.get(v.id) ?? null,
  }));
}
