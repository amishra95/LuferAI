import "server-only";

import { generateText, isStepCount, tool, type ModelMessage } from "ai";
import { z } from "zod";

import { getAgent, recordRun } from "@/lib/agents/store";
import { chatTools, searchVenueCatalogue } from "@/lib/ai/chat-tools";
import { getLanguageModel } from "@/lib/ai/model";
import { venueSearchSchema } from "@/lib/ai/venue-sourcing";
import { placeBookingRequest, type PlaceBookingResult } from "@/lib/bookings/place-booking";
import { mergeParsed, parseReservationText } from "@/lib/channels/parse-reservation";
import { channelStore, maskSender } from "@/lib/channels/store";
import { listVenues } from "@/lib/data";
import { formatDate, formatINR } from "@/lib/utils";
import type { ChannelEvent, ChannelEventStatus, ChannelId, ChannelLink } from "@/types/channels";

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
  /** Set when the run or a tool failed unexpectedly (not for ordinary validation replies). */
  error?: string;
};

type Venue = Awaited<ReturnType<typeof listVenues>>[number];

/** Earlier turns count as one conversation for this long. */
const CONVERSATION_WINDOW_MINUTES = 30;
const MAX_HISTORY_TURNS = 6;

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

async function createBooking(
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

/**
 * Turns since the last completed booking, oldest first. A finished booking
 * closes the conversation so its details don't leak into the next request.
 */
function openTurns(history: ChannelEvent[]): ChannelEvent[] {
  const turns: ChannelEvent[] = [];
  for (const e of history) {
    if (e.status === "booked") break;
    if (e.status === "replied" && e.reply) turns.push(e);
  }
  return turns.reverse();
}

/** Demo-mode handling: deterministic parse (with earlier turns), then search or book. */
async function runDeterministic(text: string, turns: ChannelEvent[], link: ChannelLink | undefined, venues: Venue[]) {
  const catalogue = { venueNames: venues.map((v) => v.name), areas: [...new Set(venues.map((v) => v.neighborhood))] };
  const parsed = mergeParsed(
    parseReservationText(text, catalogue, today()),
    [...turns].reverse().map((t) => parseReservationText(t.text, catalogue, today()))
  );
  const tools: string[] = [];

  if (parsed.intent === "book" && parsed.venueName) {
    const missing = [
      !parsed.date && "a date (e.g. 20 Nov)",
      !parsed.guests && "the number of guests",
      !parsed.budgetPerHead && "a budget per head (e.g. ₹2,500 a head)",
    ].filter(Boolean);
    if (missing.length) {
      return { reply: `To book ${parsed.venueName} I still need ${missing.join(", ")}. Just reply with the missing details.`, status: "replied" as const, tools };
    }
    tools.push("createBooking");
    const r = await createBooking(link, venues, { venueName: parsed.venueName, eventDate: parsed.date!, partySize: parsed.guests!, budgetPerHead: parsed.budgetPerHead! });
    return { reply: bookingReply(r), status: r.status === "success" ? ("booked" as const) : ("replied" as const), bookingId: r.bookingId, tools };
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
  const how = link ? `Reply "book <venue>" and I'll use the details above, or add a date, guests and budget.` : "Ask your admin to link this number in Lufer.ai to book directly.";
  return {
    reply: `Found ${result.total} venue${result.total === 1 ? "" : "s"}${parsed.guests ? ` for ${parsed.guests}` : ""}${when}:\n${lines.join("\n")}\n${how}`,
    status: "replied" as const,
    tools,
  };
}

/** Live mode: model tool loop over the conversation so far. Tool failures are returned to the model, not thrown. */
async function runModel(
  model: NonNullable<ReturnType<typeof getLanguageModel>>,
  msg: ChannelMessage,
  turns: ChannelEvent[],
  link: ChannelLink | undefined,
  venues: Venue[],
  agent: NonNullable<ReturnType<typeof getAgent>>
) {
  let bookingId: string | undefined;
  const toolErrors: string[] = [];
  const guard = async <T,>(name: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tool failed";
      toolErrors.push(`${name}: ${message}`);
      return { status: "error" as const, message: `The ${name} tool failed (${message}). Apologise briefly and suggest trying again shortly.` };
    }
  };

  const tools = {
    ...(agent.tools.includes("searchVenues") && {
      searchVenues: tool({
        description: chatTools.searchVenues.description,
        inputSchema: venueSearchSchema,
        execute: (input) => guard("searchVenues", () => searchVenueCatalogue(input)),
      }),
    }),
    createBooking: tool({
      description:
        "File a booking request at a catalogue venue for the sender's company. Call only when the sender has asked to book and venue, date, guests and per-head budget are all known (from this or earlier messages).",
      inputSchema: z.object({
        venueName: z.string().describe("Venue name exactly as in the catalogue."),
        eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
        partySize: z.number().int().min(1),
        budgetPerHead: z.number().positive().describe("INR per guest, pre-GST."),
        notes: z.string().max(500).optional(),
      }),
      execute: (args) =>
        guard("createBooking", async () => {
          const r = await createBooking(link, venues, args);
          if (r.bookingId) bookingId = r.bookingId;
          return r;
        }),
    }),
  };

  const history: ModelMessage[] = turns.flatMap((t) => [
    { role: "user" as const, content: t.text },
    { role: "assistant" as const, content: t.reply ?? "" },
  ]);

  const result = await generateText({
    model,
    system:
      `You are Lufer.ai's booking concierge on ${msg.channel === "whatsapp" ? "WhatsApp" : "Slack"} for corporate events in Bengaluru, India. Today is ${today()}. ` +
      (link ? `The sender is ${link.userName}; bookings go on their company account. ` : "The sender is not linked to an account: you may search but not book; tell them to ask their admin to link them. ") +
      "Use earlier messages in this conversation to fill in details; ask only for what is still missing. " +
      "Use searchVenues to find options and createBooking to file a request. Never invent venues, prices or booking references. Amounts are INR. " +
      "Reply in under 80 words, plain text, *bold* for venue names, no markdown headings or tables.",
    messages: [...history, { role: "user", content: msg.text }],
    tools,
    stopWhen: isStepCount(agent.maxSteps),
    ...(agent.temperature !== null && { temperature: agent.temperature }),
  });

  return {
    reply: result.text.trim() || "Sorry, I couldn't work that out. Could you rephrase?",
    status: bookingId ? ("booked" as const) : ("replied" as const),
    bookingId,
    tools: result.steps.flatMap((s) => s.toolCalls.flatMap((c) => (c ? [c.toolName] : []))),
    steps: result.steps.length,
    tokens: result.totalUsage.totalTokens ?? 0,
    error: toolErrors.length ? toolErrors.join("; ") : undefined,
  };
}

/**
 * Handles one inbound channel message end to end: logs it, runs the
 * channel-concierge agent with the sender's recent turns (model tool loop when
 * a model is configured, the deterministic parser otherwise) and returns the
 * reply to send back. Never throws: failures come back as status "failed".
 */
export async function runChannelAgent(msg: ChannelMessage): Promise<ChannelAgentResult> {
  const started = Date.now();
  const store = channelStore();
  const eventId = crypto.randomUUID();
  const test = Boolean(msg.test);

  let link: ChannelLink | undefined;
  let turns: ChannelEvent[] = [];
  try {
    [link, turns] = await Promise.all([
      store.findLink(msg.channel, msg.senderId),
      store
        .conversation({ channel: msg.channel, senderId: msg.senderId, test, sinceMinutes: CONVERSATION_WINDOW_MINUTES, limit: MAX_HISTORY_TURNS })
        .then(openTurns),
    ]);
    await store.addEvent({
      id: eventId,
      channel: msg.channel,
      senderId: msg.senderId,
      sender: maskSender(msg.channel, msg.senderId),
      senderName: link?.userName,
      text: msg.text.slice(0, 4000),
      status: "running",
      tools: [],
      steps: 0,
      tokens: 0,
      durationMs: null,
      at: new Date().toISOString(),
      test,
      delivery: test ? "skipped" : "pending",
    });
  } catch (err) {
    // Without the store we can't tell linked senders apart, so don't book; still answer.
    console.error("channels: store unavailable", err);
    return {
      eventId,
      reply: "Sorry, we're having trouble on our side. Please try again in a few minutes.",
      status: "failed",
      tools: [],
      error: err instanceof Error ? err.message : "Store unavailable",
    };
  }

  const agent = getAgent("channel-concierge")!;
  const finish = async (r: Omit<ChannelAgentResult, "eventId">, extra: { steps?: number; tokens?: number } = {}) => {
    const durationMs = Date.now() - started;
    try {
      await store.updateEvent(eventId, {
        status: r.status,
        reply: r.reply,
        bookingId: r.bookingId,
        tools: r.tools,
        steps: extra.steps ?? r.tools.length,
        tokens: extra.tokens ?? 0,
        durationMs,
        error: r.error,
      });
    } catch (err) {
      console.error("channels: failed to update message log", err);
    }
    if (r.status !== "ignored") {
      recordRun("channel-concierge", { at: new Date().toISOString(), ok: r.status !== "failed" && !r.error, durationMs, source: msg.channel, error: r.error });
    }
    return { eventId, ...r };
  };

  if (!agent.enabled) {
    return finish({ reply: "Lufer.ai isn't taking chat requests right now. Please use the client portal.", status: "ignored", tools: [] });
  }

  try {
    const venues = await listVenues();
    const model = getLanguageModel();
    if (!model) return finish(await runDeterministic(msg.text, turns, link, venues));
    const { steps, tokens, ...r } = await runModel(model, msg, turns, link, venues, agent);
    return finish(r, { steps, tokens });
  } catch (err) {
    console.error(`channels: ${msg.channel} agent run failed`, err);
    return finish({
      reply: "Sorry, something went wrong on our side. Please try again in a moment.",
      status: "failed",
      tools: [],
      error: err instanceof Error ? err.message : "Agent run failed",
    });
  }
}

/** Records whether the reply reached WhatsApp/Slack. Logging failures are swallowed (the reply already went or didn't). */
export async function recordDelivery(eventId: string, outcome: { ok: true } | { ok: false; error: string }) {
  try {
    await channelStore().updateEvent(eventId, outcome.ok ? { delivery: "sent" } : { delivery: "failed", status: "failed", error: outcome.error });
  } catch (err) {
    console.error("channels: failed to record delivery", err);
  }
}
