/**
 * Who's in an event workspace, and where their cursor is. The Realtime channel
 * plumbing lives in app/(dashboard)/client/events/[id]/_components/event-room.tsx;
 * this is the pure part (tests/event-workspace.test.mjs).
 *
 * Channel `event:<booking id>` (private; authorised by migration 0022):
 * - presence, keyed by user id: one CollaboratorMeta per open tab;
 * - broadcast `cursor`: CursorMessage, throttled by the sender;
 * - postgres_changes on event_attendees / event_workspaces: re-render the page.
 */

export const eventTopic = (bookingId: string) => `event:${bookingId}`;

/** Sections of the workspace a collaborator can be focused on. */
export const ROOM_SECTIONS = ["plan", "schedule", "guests", "invite"] as const;
export type RoomSection = (typeof ROOM_SECTIONS)[number];

export interface CollaboratorMeta {
  userId: string;
  name: string;
  /** ISO time the tab joined. */
  joinedAt: string;
  section: RoomSection | null;
}

export interface Collaborator extends CollaboratorMeta {
  color: string;
  initials: string;
  tabs: number;
  self: boolean;
}

/** Cursor position as a fraction of the workspace canvas, so it maps across screen sizes. */
export interface CursorMessage {
  userId: string;
  x: number;
  y: number;
}

export interface CursorPosition extends CursorMessage {
  /** Receiver's clock (ms) when last seen. */
  seenAt: number;
}

// Distinct in hue and readable on the zinc-950 canvas; identity only, not status.
const PALETTE = ["#60a5fa", "#f472b6", "#a78bfa", "#2dd4bf", "#fb923c", "#facc15", "#38bdf8", "#e879f9"];

/** A stable colour per user, the same in every collaborator's browser. */
export function colorFor(userId: string): string {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) h = Math.imul(h ^ userId.charCodeAt(i), 16777619);
  return PALETTE[(h >>> 0) % PALETTE.length];
}

/** "asha.rao@nimbus.in" → "Asha Rao". */
export function displayName(email: string | null, fallback = "Teammate"): string {
  const local = email?.split("@")[0] ?? "";
  const words = local.split(/[._+-]+/).filter((w) => /^[a-z]/i.test(w));
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ") : fallback;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/**
 * Supabase presence state (key → one meta per tab) → one entry per person:
 * yourself first, then by who joined first. A person's focus is their most
 * recently joined tab's.
 */
export function roster(state: Record<string, Partial<CollaboratorMeta>[]>, selfId: string): Collaborator[] {
  const people: Collaborator[] = [];
  for (const metas of Object.values(state)) {
    const valid = metas.filter((m): m is CollaboratorMeta => typeof m.userId === "string" && typeof m.name === "string" && typeof m.joinedAt === "string");
    if (!valid.length) continue;
    const sorted = [...valid].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    people.push({
      ...first,
      section: latest.section ?? null,
      color: colorFor(first.userId),
      initials: initials(first.name),
      tabs: valid.length,
      self: first.userId === selfId,
    });
  }
  return people.sort((a, b) => Number(b.self) - Number(a.self) || a.joinedAt.localeCompare(b.joinedAt));
}

/** Pointer position → fractions of `rect`, or null outside it. */
export function normalizeCursor(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 };
}

/** A broadcast payload we'll draw, or null (malformed, out of range, or our own). */
export function parseCursor(payload: unknown, selfId: string): CursorMessage | null {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const { userId, x, y } = p;
  if (typeof userId !== "string" || userId === selfId) return null;
  if (typeof x !== "number" || typeof y !== "number" || !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
  return { userId, x, y };
}

/** Cursors seen within `ttlMs`, from people still present. */
export function liveCursors(cursors: Map<string, CursorPosition>, present: Set<string>, now: number, ttlMs = 10_000): CursorPosition[] {
  return [...cursors.values()].filter((c) => present.has(c.userId) && now - c.seenAt <= ttlMs);
}
