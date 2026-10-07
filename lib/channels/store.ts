import "server-only";

import { memoryStore } from "@/lib/channels/store-memory";
import { supabaseStore } from "@/lib/channels/store-supabase";
import { isSupabaseConfigured } from "@/lib/supabase/admin";
import type { ChannelEvent, ChannelId, ChannelLink } from "@/types/channels";

export { maskSender } from "@/lib/channels/mask";

/**
 * Channel persistence: toggles, sender links, the message log and webhook
 * de-duplication. Supabase when configured (same switch as lib/data), server
 * memory otherwise so demo mode still works.
 */
export interface ChannelStore {
  backend: "supabase" | "memory";
  isEnabled(c: ChannelId): Promise<boolean>;
  setEnabled(c: ChannelId, on: boolean): Promise<void>;
  listLinks(channel?: ChannelId): Promise<ChannelLink[]>;
  findLink(channel: ChannelId, senderId: string): Promise<ChannelLink | undefined>;
  upsertLink(link: ChannelLink): Promise<void>;
  removeLink(channel: ChannelId, senderId: string): Promise<void>;
  addEvent(e: ChannelEvent): Promise<void>;
  updateEvent(id: string, patch: Partial<ChannelEvent>): Promise<void>;
  listEvents(opts?: { channel?: ChannelId; limit?: number }): Promise<ChannelEvent[]>;
  /** A sender's recent messages on one channel, newest first. */
  conversation(opts: { channel: ChannelId; senderId: string; test: boolean; sinceMinutes: number; limit: number }): Promise<ChannelEvent[]>;
  /** True the first time a webhook message/event ID is seen; false for platform retries. */
  firstDelivery(key: string): Promise<boolean>;
}

export const channelStore = (): ChannelStore => (isSupabaseConfigured() ? supabaseStore : memoryStore);
