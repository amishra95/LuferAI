import "server-only";

import type { EscalationAction, EscalationStatus } from "@/lib/escalations/rules";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * negotiation_escalations and their audit trail (migration 0029). Before the
 * migration, opening an escalation is skipped with a warning (the instant quote
 * still stands and the RFP note says why) and the queues read as empty.
 *
 * Callers scope writes: hosts pass their own venue id; admins pass none.
 */

const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export const ESCALATIONS_UNAVAILABLE = "The escalation queue needs database migration 0029 (negotiation_escalations). Ask an admin to apply it.";

export class EscalationError extends Error {}

export interface Actor {
  id: string | null;
  /** Portal role, or "system". */
  role: string;
}

export const SYSTEM: Actor = { id: null, role: "system" };

export interface NewEscalation {
  rfpId: string;
  responseId: string;
  venueId: string;
  proposedPerHead: number;
  standardPerHead: number | null;
  partySize: number;
  reason: string;
}

export interface EscalationEvent {
  id: string;
  action: EscalationAction;
  actorRole: string;
  detail: Record<string, unknown>;
  at: string;
}

export interface Escalation {
  id: string;
  rfpId: string;
  responseId: string;
  venueId: string;
  venueName: string;
  companyName: string;
  status: EscalationStatus;
  proposedPerHead: number;
  standardPerHead: number | null;
  partySize: number;
  reason: string;
  decidedPerHead: number | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** The RFP as the client sent it. */
  rfp: { brief: string; eventDate: string | null; budgetPerHead: number | null; status: string };
  /** The response's current offer (the instant quote while open) and its package. */
  response: { status: string; perHead: number | null; menuPackageId: string | null };
  events: EscalationEvent[];
}

const SELECT =
  "*, venue:venues(name), rfp:rfps(brief, event_date, budget_per_head_inr, status, company:companies(legal_name)), response:rfp_responses(status, per_head_inr, menu_package_id), events:negotiation_escalation_events(id, action, actor_role, detail, created_at)";

type Row = {
  id: string;
  rfp_id: string;
  response_id: string;
  venue_id: string;
  status: string;
  proposed_per_head_inr: number;
  standard_per_head_inr: number | null;
  party_size: number;
  reason: string;
  decided_per_head_inr: number | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  venue: { name: string } | null;
  rfp: { brief: string; event_date: string | null; budget_per_head_inr: number | null; status: string; company: { legal_name: string } | null } | null;
  response: { status: string; per_head_inr: number | null; menu_package_id: string | null } | null;
  events: { id: string; action: string; actor_role: string; detail: Json; created_at: string }[] | null;
};

const n = (v: number | null) => (v === null ? null : Number(v));

const fromRow = (r: Row): Escalation => ({
  id: r.id,
  rfpId: r.rfp_id,
  responseId: r.response_id,
  venueId: r.venue_id,
  venueName: r.venue?.name ?? "Venue",
  companyName: (r.rfp?.company?.legal_name ?? "Client").replace(" Private Limited", ""),
  status: r.status as EscalationStatus,
  proposedPerHead: Number(r.proposed_per_head_inr),
  standardPerHead: n(r.standard_per_head_inr),
  partySize: r.party_size,
  reason: r.reason,
  decidedPerHead: n(r.decided_per_head_inr),
  decisionNote: r.decision_note,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
  rfp: { brief: r.rfp?.brief ?? "", eventDate: r.rfp?.event_date ?? null, budgetPerHead: n(r.rfp?.budget_per_head_inr ?? null), status: r.rfp?.status ?? "open" },
  response: { status: r.response?.status ?? "quoted", perHead: n(r.response?.per_head_inr ?? null), menuPackageId: r.response?.menu_package_id ?? null },
  events: (r.events ?? [])
    .map((e) => ({ id: e.id, action: e.action as EscalationAction, actorRole: e.actor_role, detail: (e.detail ?? {}) as Record<string, unknown>, at: e.created_at }))
    .sort((a, b) => a.at.localeCompare(b.at)),
});

/** Appends to the audit trail. Never throws: a trail write must not undo the action it records (it's logged instead). */
export async function recordEvent(escalationId: string, action: EscalationAction, actor: Actor, detail: Record<string, unknown> = {}): Promise<void> {
  const { error } = await createAdminClient()
    .from("negotiation_escalation_events")
    .insert({ escalation_id: escalationId, action, actor_id: actor.id, actor_role: actor.role, detail: detail as Json });
  if (error) console.error(`escalations: could not record ${action} for ${escalationId}`, error);
}

/** Opens escalations for held-back counters. Returns the ids opened; empty before the migration. */
export async function openEscalations(rows: NewEscalation[]): Promise<string[]> {
  if (rows.length === 0 || !isSupabaseConfigured()) return [];
  const { data, error } = await createAdminClient()
    .from("negotiation_escalations")
    .insert(
      rows.map((r) => ({
        rfp_id: r.rfpId,
        response_id: r.responseId,
        venue_id: r.venueId,
        proposed_per_head_inr: r.proposedPerHead,
        standard_per_head_inr: r.standardPerHead,
        party_size: r.partySize,
        reason: r.reason.slice(0, 500),
      }))
    )
    .select("id, proposed_per_head_inr, reason");
  if (isMissingTable(error)) {
    console.warn("escalations: negotiation_escalations is missing (apply migration 0029); counters were held back without a queue entry");
    return [];
  }
  if (error) throw error;
  await Promise.all(data.map((e) => recordEvent(e.id, "opened", SYSTEM, { proposedPerHead: Number(e.proposed_per_head_inr), reason: e.reason })));
  return data.map((e) => e.id);
}

/** Open escalations first (oldest first: they've waited longest), then recent decisions. */
export async function listEscalations(filter: { venueId?: string; limit?: number } = {}): Promise<{ open: Escalation[]; recent: Escalation[]; ready: boolean }> {
  if (!isSupabaseConfigured()) return { open: [], recent: [], ready: false };
  const db = createAdminClient();
  const scoped = <Q extends { eq: (c: string, v: string) => Q }>(q: Q) => (filter.venueId ? q.eq("venue_id", filter.venueId) : q);
  const [open, recent] = await Promise.all([
    scoped(db.from("negotiation_escalations").select(SELECT).eq("status", "open")).order("created_at", { ascending: true }).limit(filter.limit ?? 50),
    scoped(db.from("negotiation_escalations").select(SELECT).neq("status", "open")).order("decided_at", { ascending: false }).limit(10),
  ]);
  if (isMissingTable(open.error) || isMissingTable(recent.error)) return { open: [], recent: [], ready: false };
  if (open.error) throw open.error;
  if (recent.error) throw recent.error;
  // An escalation whose RFP closed (awarded, cancelled) can't be acted on; it's shown with the recent ones.
  const all = (open.data as unknown as Row[]).map(fromRow);
  return {
    open: all.filter((e) => e.rfp.status === "open"),
    recent: [...all.filter((e) => e.rfp.status !== "open"), ...(recent.data as unknown as Row[]).map(fromRow)],
    ready: true,
  };
}

export async function getEscalation(id: string): Promise<Escalation | null> {
  const { data, error } = await createAdminClient().from("negotiation_escalations").select(SELECT).eq("id", id).maybeSingle();
  if (isMissingTable(error)) throw new EscalationError(ESCALATIONS_UNAVAILABLE);
  if (error) throw error;
  return data ? fromRow(data as unknown as Row) : null;
}

/**
 * Moves an open escalation to its decision in one conditional update, so two
 * reviewers can't both act on it. Null when it was no longer open (or isn't
 * in the caller's venue).
 */
export async function claimDecision(
  id: string,
  scope: { venueId?: string },
  decision: { status: Exclude<EscalationStatus, "open">; perHead: number | null; note: string | null },
  actor: Actor
): Promise<Escalation | null> {
  let q = createAdminClient()
    .from("negotiation_escalations")
    .update({ status: decision.status, decided_per_head_inr: decision.perHead, decision_note: decision.note, decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open");
  if (scope.venueId) q = q.eq("venue_id", scope.venueId);
  const { data, error } = await q.select(SELECT).maybeSingle();
  if (isMissingTable(error)) throw new EscalationError(ESCALATIONS_UNAVAILABLE);
  if (error) throw error;
  return data ? fromRow(data as unknown as Row) : null;
}

/** Undoes a claim whose counter couldn't be sent (e.g. the guardrails refused the price), with the reason in the trail. */
export async function reopenEscalation(id: string, actor: Actor, reason: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("negotiation_escalations")
    .update({ status: "open", decided_per_head_inr: null, decision_note: null, decided_by: null, decided_at: null })
    .eq("id", id);
  if (error) throw error;
  await recordEvent(id, "reopened", actor, { reason });
}

/** Closes open escalations on a response the host answered by hand. Returns those closed (for notifications). */
export async function supersedeEscalations(responseId: string, actor: Actor, how: string): Promise<{ id: string; venueId: string }[]> {
  const { data, error } = await createAdminClient()
    .from("negotiation_escalations")
    .update({ status: "superseded", decided_by: actor.id, decided_at: new Date().toISOString(), decision_note: how.slice(0, 280) })
    .eq("response_id", responseId)
    .eq("status", "open")
    .select("id, venue_id");
  if (isMissingTable(error)) return [];
  if (error) throw error;
  await Promise.all(data.map((e) => recordEvent(e.id, "superseded", actor, { how })));
  return data.map((e) => ({ id: e.id, venueId: e.venue_id }));
}

/** The host's WhatsApp alert number (venue_negotiation_rules.alert_whatsapp), or null. */
export async function venueAlertNumber(venueId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("venue_negotiation_rules").select("alert_whatsapp").eq("venue_id", venueId).maybeSingle();
  if (error) return null; // before the migration the column doesn't exist: no alert
  return data?.alert_whatsapp ?? null;
}

export async function saveVenueAlertNumber(venueId: string, phone: string | null, updatedBy: string | null): Promise<void> {
  const { error } = await createAdminClient().from("venue_negotiation_rules").upsert({ venue_id: venueId, alert_whatsapp: phone, updated_by: updatedBy }, { onConflict: "venue_id" });
  if (error?.code === "42703" || error?.code === "PGRST204" || isMissingTable(error)) throw new EscalationError(ESCALATIONS_UNAVAILABLE);
  if (error) throw error;
}
