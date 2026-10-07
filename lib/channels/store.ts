import "server-only";

import type { ChannelEvent, ChannelId, ChannelLink } from "@/types/channels";

/**
 * Channel toggles, sender links, recent activity and webhook de-duplication,
 * held in server memory on globalThis (same approach as lib/agents/store.ts):
 * survives hot reloads, resets on restart, per-instance when deployed. Move to
 * Supabase tables to persist links and history.
 */
type State = {
  enabled: Record<ChannelId, boolean>;
  links: ChannelLink[];
  events: ChannelEvent[];
  /** Message/event IDs already handled; Meta and Slack both retry deliveries. */
  seen: Map<string, number>;
};

const MAX_EVENTS = 50;
const SEEN_TTL_MS = 60 * 60_000;

const g = globalThis as typeof globalThis & { __luferChannels?: State };
const state = (g.__luferChannels ??= {
  enabled: { whatsapp: true, slack: true },
  links: [],
  events: [],
  seen: new Map(),
});

export const isChannelEnabled = (c: ChannelId) => state.enabled[c];
export function setChannelEnabled(c: ChannelId, on: boolean) {
  state.enabled[c] = on;
}

export const listLinks = (channel?: ChannelId) => state.links.filter((l) => !channel || l.channel === channel).map((l) => ({ ...l }));
export const findLink = (channel: ChannelId, senderId: string) => state.links.find((l) => l.channel === channel && l.senderId === senderId);

export function upsertLink(link: ChannelLink) {
  state.links = [...state.links.filter((l) => !(l.channel === link.channel && l.senderId === link.senderId)), link];
}
export function removeLink(channel: ChannelId, senderId: string) {
  state.links = state.links.filter((l) => !(l.channel === channel && l.senderId === senderId));
}

export function addEvent(e: ChannelEvent) {
  state.events = [e, ...state.events].slice(0, MAX_EVENTS);
}
export function updateEvent(id: string, patch: Partial<ChannelEvent>) {
  const e = state.events.find((x) => x.id === id);
  if (e) Object.assign(e, patch);
}
export const listEvents = (channel?: ChannelId) => state.events.filter((e) => !channel || e.channel === channel).map((e) => ({ ...e }));

/** True the first time an ID is seen (within the TTL); false for retries. */
export function firstDelivery(key: string, now = Date.now()): boolean {
  for (const [k, at] of state.seen) if (now - at > SEEN_TTL_MS) state.seen.delete(k);
  if (state.seen.has(key)) return false;
  state.seen.set(key, now);
  return true;
}

/** "+91 98•••• 3210" / "U04•••9XK": enough to recognise a sender without exposing it. */
export function maskSender(channel: ChannelId, id: string): string {
  if (channel === "whatsapp") return id.length > 6 ? `+${id.slice(0, 4)}•••${id.slice(-4)}` : `+${id}`;
  return id.length > 6 ? `${id.slice(0, 3)}•••${id.slice(-3)}` : id;
}
