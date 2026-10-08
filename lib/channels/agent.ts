import "server-only";

import { generateText, isStepCount, tool, type ModelMessage } from "ai";

import { getAgent, recordRun } from "@/lib/agents/store";
import { clip } from "@/lib/telemetry/runs";
import { searchVenueCatalogue, searchVenuesTool } from "@/lib/ai/chat-tools";
import { aiCircuitOpen, getLanguageModel, isAiUnavailable } from "@/lib/ai/model";
import { venueSearchSchema } from "@/lib/ai/venue-sourcing";
import { placeBookingRequest, type PlaceBookingResult } from "@/lib/bookings/place-booking";
import { mergeParsed, parseReservationText } from "@/lib/channels/parse-reservation";
import { channelStore, maskSender } from "@/lib/channels/store";
import { listVenues } from "@/lib/data";
import { bookingRules, checkToolCall } from "@/lib/guardrails/engine";
import { createBookingInput, type CreateBookingInput } from "@/lib/guardrails/schemas";
import { bookingActivity, recordBooking } from "@/lib/guardrails/state";
import { listDirectory } from "@/lib/venues/directory";
import { formatDate, formatINR } from "@/lib/utils";
import type { ChannelEvent, ChannelEventStatus, ChannelId, ChannelLink } from "@/types/channels";

export type ChannelMessage = {
  channel: ChannelId;
  /** WhatsApp wa_id or Slack member ID. */
  senderId: string;
  text: string;
  /** From the Settings test console rather than a real webhook. */
  test?: boolean;
  /** Message-log id to use, fixed by the caller so a durable retry logs (and replies) under one id. */
  eventId?: string;
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
function matchVenue<V extends { name: string }>(venues: V[], name: string): V | undefined {
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

/**
 * Files a booking for a linked sender (model tool and deterministic parser alike).
 * The guardrail (lib/guardrails) runs before anything is written: unlinked
 * senders, events beyond the booking horizon, repeat requests for the same venue
 * and date, and senders over the hourly limit are refused and audited.
 * placeBookingRequest then applies the usual role, capacity, spend, policy and
 * availability checks.
 */
async function createBooking(link: ChannelLink | undefined, venues: Venue[], rawArgs: CreateBookingInput): Promise<PlaceBookingResult> {
  const venue = link ? matchVenue(venues, rawArgs.venueName) : undefined;
  if (link && !venue) return unknownVenue(rawArgs.venueName);

  const check = await checkToolCall(
    "createBooking",
    rawArgs,
    async (a) =>
      bookingRules(a, {
        today: new Date().toISOString().slice(0, 10),
        linked: Boolean(link),
        ...(link && venue ? await bookingActivity(link.channel, link.senderId, venue.id, a.eventDate) : { bookingsLastHour: 0, duplicate: false }),
      }),
    { channel: link?.channel, sender: link ? maskSender(link.channel, link.senderId) : undefined, companyId: link?.companyId, venueId: venue?.id }
  );
  if (!check.ok) return { status: "error", message: check.message };
  const args = check.args;

  const result = await placeBookingRequest({
    companyId: link!.companyId,
    userId: link!.userId,
    venueId: venue!.id,
    eventDate: args.eventDate,
    partySize: args.partySize,
    budgetPerHead: args.budgetPerHead,
    notes: args.notes,
    expense: { costCenter: args.costCenter || link!.defaultCostCenter, projectCode: args.projectCode },
  });
  if (result.status === "success") {
    await recordBooking(link!.channel, link!.senderId, venue!.id, args.eventDate).catch((err) => console.error("guardrails: could not record booking activity", err));
  }
  return result;
}

/** Why a named venue can't be booked here: a partner listing, or not in the catalogue. */
async function unknownVenue(venueName: string): Promise<PlaceBookingResult> {
  // Partner-network venues are listed but booked through their supplier.
  const partner = matchVenue((await listDirectory()).venues.filter((v) => v.tier === "partner"), venueName);
  if (partner) {
    const supplier = partner.supplier ?? "its supplier network";
    return { status: "error", message: `${partner.name} is a partner venue listed by ${supplier}. Partner venues are booked through the supplier, so I can't file it here; pick one of Lufer.ai's own venues or ask your admin for a supplier quote.` };
  }
  return { status: "error", message: `No catalogue venue called "${venueName}".` };
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
async function runDeterministic(
  text: string,
  turns: ChannelEvent[],
  link: ChannelLink | undefined,
  venues: Venue[],
  directory: { name: string; neighborhood: string }[]
) {
  // Parse against the whole directory so partner venues and areas are recognised too.
  const catalogue = { venueNames: directory.map((v) => v.name), areas: [...new Set(directory.map((v) => v.neighborhood))] };
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
    const r = await createBooking(link, venues, {
      venueName: parsed.venueName,
      eventDate: parsed.date!,
      partySize: parsed.guests!,
      budgetPerHead: parsed.budgetPerHead!,
      costCenter: parsed.costCenter,
      projectCode: parsed.projectCode,
    });
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
  const lines = result.venues
    .slice(0, 4)
    .map((v) => `• *${v.name}* (${v.neighborhood}) · up to ${v.capacity} · est. ${formatINR(v.estimatedTotalInr)}${v.tier === "partner" ? ` · partner via ${v.supplier}` : ""}`);
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
        description: searchVenuesTool.description,
        inputSchema: venueSearchSchema,
        execute: (input) => guard("searchVenues", () => searchVenueCatalogue(input)),
      }),
    }),
    createBooking: tool({
      description:
        "File a booking request at a catalogue venue for the sender's company. Call only when the sender has asked to book and venue, date, guests and per-head budget are all known (from this or earlier messages).",
      inputSchema: createBookingInput,
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
      "Use searchVenues to find options and createBooking to file a request. Only internal (Lufer.ai) venues can be booked; partner venues are booked through their supplier, so say so. " +
      "Never invent venues, prices or booking references. Amounts are INR. " +
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
  const eventId = msg.eventId ?? crypto.randomUUID();
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
      void recordRun("channel-concierge", {
        at: new Date().toISOString(),
        ok: r.status !== "failed" && !r.error,
        durationMs,
        source: msg.channel,
        error: r.error,
        task: `${msg.channel === "whatsapp" ? "WhatsApp" : "Slack"}: “${clip(msg.text)}”`,
        tokens: extra.tokens,
        steps: extra.steps ?? r.tools.length,
      });
    }
    return { eventId, ...r };
  };

  if (!agent.enabled) {
    return finish({ reply: "Lufer.ai isn't taking chat requests right now. Please use the client portal.", status: "ignored", tools: [] });
  }

  try {
    const [venues, directory] = await Promise.all([listVenues(), listDirectory()]);
    const model = getLanguageModel();
    // No model, or the provider is down (circuit open / retries exhausted): the deterministic parser still answers.
    if (!model || aiCircuitOpen()) return finish(await runDeterministic(msg.text, turns, link, venues, directory.venues));
    try {
      const { steps, tokens, ...r } = await runModel(model, msg, turns, link, venues, agent);
      return finish(r, { steps, tokens });
    } catch (err) {
      if (!isAiUnavailable(err)) throw err;
      console.warn(`channels: ${msg.channel} model unavailable, answering with the parser`, err);
      return finish(await runDeterministic(msg.text, turns, link, venues, directory.venues));
    }
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
