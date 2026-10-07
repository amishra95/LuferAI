"use server";

import { revalidatePath } from "next/cache";

import { runChannelAgent } from "@/lib/channels/agent";
import { CHANNEL_ENV } from "@/lib/channels/config";
import { removeLink, setChannelEnabled, upsertLink } from "@/lib/channels/store";
import { listPortalUsers } from "@/lib/data";
import { canEditEnvFile, updateEnvFile } from "@/lib/settings/env-file";
import type { ChannelEventStatus, ChannelId } from "@/types/channels";

import type { FormState } from "./actions";

const CHANNELS: ChannelId[] = ["whatsapp", "slack"];
const asChannel = (v: FormDataEntryValue | string | null): ChannelId | null => (CHANNELS.includes(v as ChannelId) ? (v as ChannelId) : null);

/**
 * Linking senders and test messages can file real bookings, and keys are
 * secrets, so like the OpenAI key they're only editable from `next dev` on
 * localhost (there is no sign-in yet).
 */
const LOCAL_ONLY: FormState = {
  status: "error",
  message: "Only editable from `next dev` on localhost. Configure channels in your host's environment instead.",
};

export async function setChannelEnabledAction(channel: string, on: boolean): Promise<void> {
  const c = asChannel(channel);
  if (!c) throw new Error("Unknown channel.");
  setChannelEnabled(c, on);
  revalidatePath("/settings");
}

export async function saveChannelSecrets(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await canEditEnvFile())) return LOCAL_ONLY;
  const channel = asChannel(form.get("channel"));
  if (!channel) return { status: "error", message: "Unknown channel." };

  const updates: Record<string, string> = {};
  for (const { key, label } of CHANNEL_ENV[channel]) {
    const value = String(form.get(key) ?? "").trim();
    if (!value) continue; // blank keeps the current value
    if (/\s/.test(value) || value.length > 512) return { status: "error", message: `${label} can't contain spaces and must be under 512 characters.` };
    if (key === "SLACK_BOT_TOKEN" && !value.startsWith("xoxb-")) return { status: "error", message: "Slack bot tokens start with xoxb-." };
    if (key === "WHATSAPP_PHONE_NUMBER_ID" && !/^\d{6,20}$/.test(value)) return { status: "error", message: "The phone number ID is numeric." };
    updates[key] = value;
  }
  if (!Object.keys(updates).length) return { status: "error", message: "Enter at least one value to save." };

  await updateEnvFile(updates);
  revalidatePath("/settings");
  return { status: "success", message: `Saved ${Object.keys(updates).length} value${Object.keys(updates).length === 1 ? "" : "s"} to .env.local.` };
}

/** Normalises a sender ID: WhatsApp wa_id is digits with country code; Slack member IDs are U…/W…. */
function normaliseSender(channel: ChannelId, raw: string): string | null {
  if (channel === "whatsapp") {
    const digits = raw.replace(/[\s()+-]/g, "");
    return /^\d{8,15}$/.test(digits) ? digits : null;
  }
  const id = raw.trim().toUpperCase();
  return /^[UW][A-Z0-9]{6,15}$/.test(id) ? id : null;
}

export async function linkSender(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await canEditEnvFile())) return LOCAL_ONLY;
  const channel = asChannel(form.get("channel"));
  if (!channel) return { status: "error", message: "Unknown channel." };
  const senderId = normaliseSender(channel, String(form.get("senderId") ?? ""));
  if (!senderId) {
    return {
      status: "error",
      message: channel === "whatsapp" ? "Enter the number with country code, e.g. +91 98765 43210." : "Enter a Slack member ID, e.g. U04ABCD123.",
    };
  }
  const user = (await listPortalUsers()).find((u) => u.id === String(form.get("userId") ?? ""));
  if (!user?.companyId) return { status: "error", message: "Choose a client user to book as." };

  upsertLink({ channel, senderId, userId: user.id, companyId: user.companyId, userName: user.name });
  revalidatePath("/settings");
  return { status: "success", message: `Linked to ${user.name}.` };
}

export async function unlinkSender(channel: string, senderId: string): Promise<FormState> {
  if (!(await canEditEnvFile())) return LOCAL_ONLY;
  const c = asChannel(channel);
  if (!c) return { status: "error", message: "Unknown channel." };
  removeLink(c, senderId);
  revalidatePath("/settings");
  return { status: "success", message: "Unlinked." };
}

export type TestMessageState = FormState & { reply?: string; outcome?: ChannelEventStatus; tools?: string[] };

/** Runs a message through the real channel agent (no outbound send) and returns the reply it would post. */
export async function sendTestMessage(_prev: TestMessageState, form: FormData): Promise<TestMessageState> {
  if (!(await canEditEnvFile())) return LOCAL_ONLY;
  const channel = asChannel(form.get("channel"));
  const text = String(form.get("text") ?? "").trim();
  if (!channel) return { status: "error", message: "Unknown channel." };
  if (text.length < 2 || text.length > 1000) return { status: "error", message: "Write a message (2–1000 characters)." };

  const senderId = String(form.get("senderId") ?? "") || (channel === "whatsapp" ? "910000000000" : "UTESTSENDER");
  const result = await runChannelAgent({ channel, senderId, text, test: true });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { status: "success", reply: result.reply, outcome: result.status, tools: result.tools };
}
