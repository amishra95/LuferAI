/**
 * The event workspace's activity ticker: what collaborators and guests did,
 * newest first. Seeded from the page's data on every render (so it's never
 * empty and survives a reload), then extended live from the room's Realtime
 * channel (event-room.tsx): `activity` broadcasts after a teammate's save, and
 * guests' RSVPs from postgres_changes. Pure: tests/event-workspace.test.mjs.
 */
import { isRsvpStatus, RSVP_LABEL } from "./rsvp.ts";

export type ActivityKind = "rsvp" | "guests" | "schedule";

export interface ActivityItem {
  id: string;
  /** ISO time. */
  at: string;
  /** Who did it: a teammate's display name, or the guest who replied. */
  actor: string;
  kind: ActivityKind;
  text: string;
}

export const MAX_ACTIVITY = 30;

/** Guests added by the same person within this window are one "added N guests" entry. */
const BATCH_MS = 2 * 60_000;

/**
 * Activity reconstructed from the data: replies (responded_at), guests added
 * (created_at, batched per inviter), and the last schedule change.
 */
export function seedActivity(input: {
  attendees: { id: string; name: string; rsvp_status: string; responded_at: string | null; created_at: string; invited_by: string | null }[];
  workspace: { id: string; updated_at: string; ics_sequence: number; updated_by: string | null };
  /** user id → display name, for "who added" and "who changed". */
  people?: Record<string, string>;
}): ActivityItem[] {
  const name = (id: string | null) => (id && input.people?.[id]) || "A teammate";
  const items: ActivityItem[] = [];

  for (const a of input.attendees) {
    if (a.responded_at && isRsvpStatus(a.rsvp_status) && a.rsvp_status !== "INVITED") {
      items.push({ id: `rsvp:${a.id}:${a.responded_at}`, at: a.responded_at, actor: a.name, kind: "rsvp", text: `replied ${RSVP_LABEL[a.rsvp_status].toLowerCase()}` });
    }
  }

  const added = [...input.attendees].sort((x, y) => x.created_at.localeCompare(y.created_at));
  let batch: typeof added = [];
  const flush = () => {
    if (!batch.length) return;
    const last = batch[batch.length - 1];
    items.push({
      id: `guests:${batch[0].id}`,
      at: last.created_at,
      actor: name(batch[0].invited_by),
      kind: "guests",
      text: batch.length === 1 ? `added ${batch[0].name}` : `added ${batch.length} guests`,
    });
    batch = [];
  };
  for (const a of added) {
    const prev = batch[batch.length - 1];
    if (prev && (prev.invited_by !== a.invited_by || Date.parse(a.created_at) - Date.parse(prev.created_at) > BATCH_MS)) flush();
    batch.push(a);
  }
  flush();

  if (input.workspace.id) {
    items.push({
      id: `schedule:${input.workspace.ics_sequence}:${input.workspace.updated_at}`,
      at: input.workspace.updated_at,
      actor: name(input.workspace.updated_by),
      kind: "schedule",
      text: "updated the schedule",
    });
  }
  return sortActivity(items).slice(0, MAX_ACTIVITY);
}

const sortActivity = (items: ActivityItem[]) => items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

/**
 * Adds live items to the feed. The same event can arrive twice (a teammate's
 * broadcast, then the re-seeded page data): items with the same id, or the
 * same actor, kind and text within two minutes, are kept once.
 */
export function mergeActivity(current: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const item of sortActivity([...incoming, ...current])) {
    const dup = out.some(
      (o) => o.id === item.id || (o.kind === item.kind && o.actor === item.actor && o.text === item.text && Math.abs(Date.parse(o.at) - Date.parse(item.at)) <= BATCH_MS)
    );
    if (!dup) out.push(item);
  }
  return out.slice(0, MAX_ACTIVITY);
}

/** A teammate's `activity` broadcast, validated (it comes from another browser). */
export function parseActivity(payload: unknown): ActivityItem | null {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const { id, at, actor, kind, text } = p;
  if (typeof id !== "string" || id.length > 100) return null;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
  if (typeof actor !== "string" || actor.length < 1 || actor.length > 80) return null;
  if (kind !== "rsvp" && kind !== "guests" && kind !== "schedule") return null;
  if (typeof text !== "string" || text.length < 1 || text.length > 140) return null;
  return { id, at, actor, kind, text };
}

/** A guest's reply arriving as a postgres_changes UPDATE on event_attendees. */
export function activityFromAttendeeChange(change: { eventType?: string; new?: unknown; old?: unknown }): ActivityItem | null {
  if (change.eventType !== "UPDATE") return null;
  const row = (change.new ?? {}) as Record<string, unknown>;
  const before = (change.old ?? {}) as Record<string, unknown>;
  const { id, name, rsvp_status: status, responded_at: at } = row;
  if (typeof id !== "string" || typeof name !== "string" || typeof at !== "string" || !isRsvpStatus(status) || status === "INVITED") return null;
  // Only a change of reply (old rows carry just the key without REPLICA IDENTITY FULL).
  if (before.rsvp_status !== undefined && before.rsvp_status === status) return null;
  return { id: `rsvp:${id}:${at}`, at, actor: name, kind: "rsvp", text: `replied ${RSVP_LABEL[status].toLowerCase()}` };
}

/** "just now", "4m ago", "2h ago", then a date. */
export function relativeTime(at: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(at));
}
