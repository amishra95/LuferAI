import "server-only";

import type { ChannelStore } from "@/lib/channels/store";
import type { ChannelEvent, ChannelId, ChannelLink } from "@/types/channels";

/**
 * Fallback when Supabase isn't configured: server memory on globalThis, like
 * lib/data/mock-store.ts. Survives hot reloads, resets on restart.
 */
type State = { enabled: Record<ChannelId, boolean>; links: ChannelLink[]; events: ChannelEvent[]; seen: Map<string, number> };

const MAX_EVENTS = 200;
const SEEN_TTL_MS = 24 * 60 * 60_000;

const g = globalThis as typeof globalThis & { __luferChannels?: State };
const state = (g.__luferChannels ??= { enabled: { whatsapp: true, slack: true }, links: [], events: [], seen: new Map() });
// Processes started before these fields existed.
for (const e of state.events) {
  e.senderId ??= "";
  e.delivery ??= "skipped";
}

export const memoryStore: ChannelStore = {
  backend: "memory",
  async isEnabled(c) {
    return state.enabled[c];
  },
  async setEnabled(c, on) {
    state.enabled[c] = on;
  },
  async listLinks(channel) {
    return state.links.filter((l) => !channel || l.channel === channel).map((l) => ({ ...l }));
  },
  async findLink(channel, senderId) {
    const l = state.links.find((x) => x.channel === channel && x.senderId === senderId);
    return l ? { ...l } : undefined;
  },
  async upsertLink(link) {
    state.links = [...state.links.filter((l) => !(l.channel === link.channel && l.senderId === link.senderId)), link];
  },
  async removeLink(channel, senderId) {
    state.links = state.links.filter((l) => !(l.channel === channel && l.senderId === senderId));
  },
  async addEvent(e) {
    state.events = [e, ...state.events].slice(0, MAX_EVENTS);
  },
  async updateEvent(id, patch) {
    const e = state.events.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  },
  async listEvents({ channel, limit = 50 } = {}) {
    return state.events.filter((e) => !channel || e.channel === channel).slice(0, limit).map((e) => ({ ...e }));
  },
  async conversation({ channel, senderId, test, sinceMinutes, limit }) {
    const since = Date.now() - sinceMinutes * 60_000;
    return state.events
      .filter((e) => e.channel === channel && e.senderId === senderId && e.test === test && new Date(e.at).getTime() >= since)
      .slice(0, limit)
      .map((e) => ({ ...e }));
  },
  async firstDelivery(key) {
    const now = Date.now();
    for (const [k, at] of state.seen) if (now - at > SEEN_TTL_MS) state.seen.delete(k);
    if (state.seen.has(key)) return false;
    state.seen.set(key, now);
    return true;
  },
  async releaseDelivery(key) {
    state.seen.delete(key);
  },
};
