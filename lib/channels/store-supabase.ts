import "server-only";

import type { ChannelStore } from "@/lib/channels/store";
import { maskSender } from "@/lib/channels/mask";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { ChannelEvent, ChannelEventStatus, ChannelId, DeliveryStatus } from "@/types/channels";

type MessageRow = Database["public"]["Tables"]["channel_messages"]["Row"];
type MessageUpdate = Database["public"]["Tables"]["channel_messages"]["Update"];

const RECEIPT_TTL_MS = 24 * 60 * 60_000;

/** Supabase errors as plain Errors with a readable message. */
function fail(op: string, error: { message: string }): never {
  throw new Error(`Supabase (${op}): ${error.message}`);
}

function toEvent(r: MessageRow): ChannelEvent {
  const channel = r.channel as ChannelId;
  return {
    id: r.id,
    channel,
    senderId: r.sender_id,
    sender: maskSender(channel, r.sender_id),
    senderName: r.sender_name ?? undefined,
    text: r.inbound_text,
    reply: r.reply_text ?? undefined,
    status: r.status as ChannelEventStatus,
    bookingId: r.booking_id ?? undefined,
    tools: r.tools,
    steps: r.steps,
    tokens: r.tokens,
    durationMs: r.duration_ms,
    at: r.created_at,
    test: r.is_test,
    delivery: r.delivery_status as DeliveryStatus,
    error: r.error ?? undefined,
  };
}

function toUpdate(patch: Partial<ChannelEvent>): MessageUpdate {
  const u: MessageUpdate = {};
  if (patch.status !== undefined) u.status = patch.status;
  if (patch.reply !== undefined) u.reply_text = patch.reply;
  if (patch.bookingId !== undefined) u.booking_id = patch.bookingId;
  if (patch.tools !== undefined) u.tools = patch.tools;
  if (patch.steps !== undefined) u.steps = patch.steps;
  if (patch.tokens !== undefined) u.tokens = patch.tokens;
  if (patch.durationMs !== undefined) u.duration_ms = patch.durationMs;
  if (patch.delivery !== undefined) u.delivery_status = patch.delivery;
  if (patch.error !== undefined) u.error = patch.error;
  if (patch.senderName !== undefined) u.sender_name = patch.senderName;
  return u;
}

/** Postgres persistence (supabase/migrations/20261007120000_channel_integrations.sql), via the service role. */
export const supabaseStore: ChannelStore = {
  backend: "supabase",

  async isEnabled(c) {
    const { data, error } = await createAdminClient().from("channel_settings").select("enabled").eq("channel", c).maybeSingle();
    if (error) fail("read channel setting", error);
    return data?.enabled ?? true; // no row yet → default on, matching the migration's seed
  },

  async setEnabled(c, on) {
    const { error } = await createAdminClient()
      .from("channel_settings")
      .upsert({ channel: c, enabled: on, updated_at: new Date().toISOString() });
    if (error) fail("save channel setting", error);
  },

  async listLinks(channel) {
    let q = createAdminClient().from("channel_sender_links").select("*").order("created_at");
    if (channel) q = q.eq("channel", channel);
    const { data, error } = await q;
    if (error) fail("list sender links", error);
    return data.map((r) => ({
      channel: r.channel as ChannelId,
      senderId: r.sender_id,
      userId: r.user_id,
      companyId: r.company_id,
      userName: r.user_name,
      defaultCostCenter: r.default_cost_center ?? undefined,
    }));
  },

  async findLink(channel, senderId) {
    const { data, error } = await createAdminClient()
      .from("channel_sender_links")
      .select("*")
      .eq("channel", channel)
      .eq("sender_id", senderId)
      .maybeSingle();
    if (error) fail("find sender link", error);
    return data
      ? { channel, senderId, userId: data.user_id, companyId: data.company_id, userName: data.user_name, defaultCostCenter: data.default_cost_center ?? undefined }
      : undefined;
  },

  async upsertLink(l) {
    const { error } = await createAdminClient()
      .from("channel_sender_links")
      .upsert(
        {
          channel: l.channel,
          sender_id: l.senderId,
          user_id: l.userId,
          company_id: l.companyId,
          user_name: l.userName,
          default_cost_center: l.defaultCostCenter ?? null,
        },
        { onConflict: "channel,sender_id" }
      );
    if (error) fail("save sender link", error);
  },

  async removeLink(channel, senderId) {
    const { error } = await createAdminClient().from("channel_sender_links").delete().eq("channel", channel).eq("sender_id", senderId);
    if (error) fail("remove sender link", error);
  },

  async addEvent(e) {
    const { error } = await createAdminClient().from("channel_messages").insert({
      id: e.id,
      channel: e.channel,
      sender_id: e.senderId,
      sender_name: e.senderName ?? null,
      inbound_text: e.text.slice(0, 4000),
      reply_text: e.reply ?? null,
      status: e.status,
      delivery_status: e.delivery,
      booking_id: e.bookingId ?? null,
      tools: e.tools,
      steps: e.steps,
      tokens: e.tokens,
      duration_ms: e.durationMs,
      is_test: e.test,
      error: e.error ?? null,
      created_at: e.at,
    });
    if (error) fail("log message", error);
  },

  async updateEvent(id, patch) {
    const u = toUpdate(patch);
    if (!Object.keys(u).length) return;
    const { error } = await createAdminClient().from("channel_messages").update(u).eq("id", id);
    if (error) fail("update message log", error);
  },

  async listEvents({ channel, limit = 50 } = {}) {
    let q = createAdminClient().from("channel_messages").select("*").order("created_at", { ascending: false }).limit(limit);
    if (channel) q = q.eq("channel", channel);
    const { data, error } = await q;
    if (error) fail("list messages", error);
    return data.map(toEvent);
  },

  async conversation({ channel, senderId, test, sinceMinutes, limit }) {
    const { data, error } = await createAdminClient()
      .from("channel_messages")
      .select("*")
      .eq("channel", channel)
      .eq("sender_id", senderId)
      .eq("is_test", test)
      .gte("created_at", new Date(Date.now() - sinceMinutes * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail("load conversation", error);
    return data.map(toEvent);
  },

  async firstDelivery(key) {
    const db = createAdminClient();
    const { error } = await db.from("channel_webhook_receipts").insert({ key });
    // Occasionally prune old receipts; platforms stop retrying well within a day.
    if (Math.random() < 0.02) {
      await db.from("channel_webhook_receipts").delete().lt("received_at", new Date(Date.now() - RECEIPT_TTL_MS).toISOString());
    }
    if (!error) return true;
    if (error.code === "23505") return false; // unique violation: already received
    fail("record webhook receipt", error);
  },
};
