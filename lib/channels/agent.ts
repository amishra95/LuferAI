import "server-only";

import { generateId, generateText, isStepCount, tool } from "ai";
import { z } from "zod";

import { getAgent, recordRun } from "@/lib/agents/store";
import { chatTools, searchVenueCatalogue } from "@/lib/ai/chat-tools";
import { getLanguageModel } from "@/lib/ai/model";
import { placeBookingRequest, type PlaceBookingResult } from "@/lib/bookings/place-booking";
import { parseReservationText } from "@/lib/channels/parse-reservation";
import { addEvent, findLink, maskSender, updateEvent } from "@/lib/channels/store";
import { listVenues } from "@/lib/data";
import { formatDate, formatINR } from "@/lib/utils";
import type { ChannelEventStatus, ChannelId, ChannelLink } from "@/types/channels";

export type ChannelMessage = {
  channel: ChannelId;
  /** WhatsApp wa_id or Slack member ID. */
  senderId: string;
  text: string;
  /** From the Settings test console rather than a real webhook. */
  test?: boolean;
};

export type ChannelAgentResult = {
  eventId: string;
  reply: string;
  status: Exclude<ChannelEventStatus, "running">;
  bookingId?: string;
  tools: string[];
};

type Venue = Awaited<ReturnType<typeof listVenues>>[number];

const today = () => new Date().toISOString().slice(0, 10);

/** Finds a catalogue venue by (partial, case-insensitive) name. */
function matchVenue(venues: Venue[], name: string): Venue | undefined {
  const n = name.trim().toLowerCase().replace(/^the\s+/, "");
  if (!n) return undefined;
  return venues.find((v) => v.name.toLowerCase().replace(/^the\s+/, "") === n) ?? venues.find((v) => v.name.toLowerCase().includes(n));
}

/** Plain-text reply for a booking attempt. *bold* renders in both WhatsApp and Slack. */
function bookingReply(r: PlaceBookingResult): string {
  if (r.status === "error") {
    const fields = Object.values(r.fieldErrors ?? {}).filter(Boolean);
    return fields.length ? `Couldn't book that yet:\n• ${fields.join("\n• ")}` : `Couldn't book that: ${r.message}`;
  }
  const ref = r.bookingId ? ` (ref ${r.bookingId.slice(0, 8)})` : "";
  if (r.approval) {
    return `*Request filed${ref}* at ${r.venueName}. It needs sign-off from ${r.approval.approverName} (${r.approval.reason}). The date is held for ${r.holdHours}h.`;
  }
  return `*Request sent${ref}* to ${r.venueName}. The date is held for ${r.holdHours}h while they confirm.`;
}

async function book(
  link: ChannelLink | undefined,
  venues: Venue[],
  args: { venueName: string; eventDate: string; partySize: number; budgetPerHead: number; notes?: string }
): Promise<PlaceBookingResult> {
  if (!link) {
    return { status: "error", message: "This sender isn't linked to a Lufer.ai account, so I can only search. Ask your admin to link you in Settings → Channels." };
  }
  const venue = matchVenue(venues, args.venueName);
  if (!venue) return { status: "error", message: `No catalogue venue called "${args.venueName}".` };
  return placeBookingRequest({
    companyId: link.companyId,
    userId: link.userId,
    venueId: venue.id,
    eventDate: args.eventDate,
    partySize: args.partySize,
    budgetPerHead: args.budgetPerHead,
    notes: args.notes,
  });
}

/** Demo-mode handling: deterministic parse, then search or book. */
async function runDeterministic(text: string, link: ChannelLink | undefined, venues: Venue[]) {
  const parsed = parseReservationText(text, { venueNames: venues.map((v) => v.name), areas: [...new Set(venues.map((v) => v.neighborhood))] }, today());
  const tools: string[] = [];

  if (parsed.intent === "book" && parsed.venueName) {
    const missing = [
      !parsed.date && "a date (e.g. 20 Nov)",
      !parsed.guests && "the number of guests",
      !parsed.budgetPerHead && "a budget per head (e.g. ₹2,500 a head)",
    ].filter(Boolean);
    if (missing.length) {
      return { reply: `To book ${parsed.venueName} I still need ${missing.join(", ")}.`, status: "replied" as const, tools };
    }
    tools.push("requestBooking");
    const r = await book(link, venues, { venueName: parsed.venueName, eventDate: parsed.date!, partySize: parsed.guests!, budgetPerHead: parsed.budgetPerHead! });
    return {
      reply: bookingReply(r),
      status: r.status === "success" ? ("booked" as const) : ("replied" as const),
      bookingId: r.bookingId,
      tools,
    };
  }

  tools.push("searchVenues");
  const result = await searchVenueCatalogue({
    location: parsed.area ?? "",
    minCapacity: parsed.guests ?? 1,
    maxBudgetPerHead: parsed.budgetPerHead ?? 0,
    features: parsed.wantsPrivateDining ? ["private dining room"] : [],
  });
  if (result.total === 0) {
    return { reply: "No catalogue venues match that. Try fewer guests, another area or a higher budget.", status: "replied" as const, tools };
  }
  const lines = result.venues.slice(0, 3).map((v) => `• *${v.name}* (${v.neighborhood}) · up to ${v.capacity} · est. ${formatINR(v.estimatedTotalInr)}`);
  const when = parsed.date ? ` on ${formatDate(parsed.date)}` : "";
  const how = link
    ? `Reply "book <venue> on <date> for <guests>, ₹<amount> a head" to file a request.`
    : "Ask your admin to link this number in Lufer.ai to book directly.";
  return { reply: `Found ${result.total} venue${result.total === 1 ? "" : "s"}${parsed.guests ? ` for ${parsed.guests}` : ""}${when}:\n${lines.join("\n")}\n${how}`, status: "replied" as const, tools };
}

/**
 * Handles one inbound channel message end to end: records activity, runs the
 * channel-concierge agent (LLM tool loop when a model is configured, the
 * deterministic parser otherwise) and returns the reply to send back.
 */
export async function runChannelAgent(msg: ChannelMessage): Promise<ChannelAgentResult> {
  const started = Date.now();
  const eventId = generateId();
  const link = findLink(msg.channel, msg.senderId);
  addEvent({
    id: eventId,
    channel: msg.channel,
    sender: maskSender(msg.channel, msg.senderId),
    senderName: link?.userName,
    text: msg.text.slice(0, 500),
    status: "running",
    tools: [],
    steps: 0,
    tokens: 0,
    durationMs: null,
    at: new Date().toISOString(),
    test: Boolean(msg.test),
  });

  const agent = getAgent("channel-concierge")!;
  const finish = (r: Omit<ChannelAgentResult, "eventId">, extra: { steps?: number; tokens?: number; error?: string } = {}) => {
    const durationMs = Date.now() - started;
    updateEvent(eventId, { status: r.status, reply: r.reply, bookingId: r.bookingId, tools: r.tools, steps: extra.steps ?? r.tools.length, tokens: extra.tokens ?? 0, durationMs, error: extra.error });
    if (r.status !== "ignored") {
      recordRun("channel-concierge", { at: new Date().toISOString(), ok: r.status !== "failed", durationMs, source: msg.channel, error: extra.error });
    }
    return { eventId, ...r };
  };

  if (!agent.enabled) {
    return finish({ reply: "Lufer.ai isn't taking chat requests right now. Please use the client portal.", status: "ignored", tools: [] });
  }

  try {
    const venues = await listVenues();
    const model = getLanguageModel();
    if (!model) return finish(await runDeterministic(msg.text, link, venues));

    let bookingId: string | undefined;
    const tools = {
      ...(agent.tools.includes("searchVenues") && { searchVenues: chatTools.searchVenues }),
      requestBooking: tool({
        description:
          "File a booking request at a catalogue venue for the sender's company. Only call this when the sender clearly asked to book and gave venue, date, guests and per-head budget.",
        inputSchema: z.object({
          venueName: z.string().describe("Venue name exactly as in the catalogue."),
          eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
          partySize: z.number().int().min(1),
          budgetPerHead: z.number().positive().describe("INR per guest, pre-GST."),
          notes: z.string().max(500).optional(),
        }),
        execute: async (args) => {
          const r = await book(link, venues, args);
          if (r.bookingId) bookingId = r.bookingId;
          return r;
        },
      }),
    };

    const result = await generateText({
      model,
      system:
        `You are Lufer.ai's booking concierge on ${msg.channel === "whatsapp" ? "WhatsApp" : "Slack"} for corporate events in Bengaluru, India. Today is ${today()}. ` +
        (link ? `The sender is ${link.userName}; bookings go on their company account. ` : "The sender is not linked to an account: you may search but not book; tell them to ask their admin to link them. ") +
        "Use searchVenues to find options and requestBooking to file a request. Never invent venues or prices. Amounts are INR. " +
        "Reply in under 80 words, plain text, *bold* for venue names, no markdown headings or tables.",
      prompt: msg.text,
      tools,
      stopWhen: isStepCount(agent.maxSteps),
      ...(agent.temperature !== null && { temperature: agent.temperature }),
    });

    const called = result.steps.flatMap((s) => s.toolCalls.flatMap((c) => (c ? [c.toolName] : [])));
    return finish(
      { reply: result.text.trim() || "Sorry, I couldn't work that out. Could you rephrase?", status: bookingId ? "booked" : "replied", bookingId, tools: called },
      { steps: result.steps.length, tokens: result.totalUsage.totalTokens ?? 0 }
    );
  } catch (err) {
    console.error(`channels: ${msg.channel} agent run failed`, err);
    return finish(
      { reply: "Sorry, something went wrong on our side. Please try again in a moment.", status: "failed", tools: [] },
      { error: err instanceof Error ? err.message : "Agent run failed" }
    );
  }
}
