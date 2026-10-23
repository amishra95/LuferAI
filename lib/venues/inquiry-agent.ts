import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { generateText, isStepCount, tool } from "ai";
import { after } from "next/server";
import { z } from "zod";

import { sendWhatsAppMessage, whatsAppProvider } from "@/lib/agent/connectors/whatsapp";
import { getLanguageModel } from "@/lib/ai/model";
import { venueInquirySystem } from "@/lib/ai/prompts";
import { venueAlertNumber } from "@/lib/escalations/store";
import { todayInIndia } from "@/lib/gst-engine";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { normalizePhone } from "@/lib/phone";
import { siteUrl } from "@/lib/site-url";
import { tracer } from "@/lib/tracer";
import {
  appendTurns,
  EMPTY_DETAILS,
  extractDetails,
  fallbackReply,
  formatEventDate,
  isQualified,
  MAX_ALTERNATIVES,
  MAX_MESSAGE_CHARS,
  mergeDetails,
  missingDetails,
  nextStatus,
  rankAlternatives,
  type InquiryStatus,
  type LeadDetails,
  type NetworkVenue,
} from "@/lib/venues/inquiry";
import { findInquiry, networkVenues, saveInquiry, venueFacts, type InquiryRow, type VenueFacts } from "@/lib/venues/inquiry-store";

/**
 * A venue's AI inquiry agent (/inquire/<venue id>, POST /api/inquiries): one
 * turn of the conversation. It answers from the venue's own facts, checks the
 * date, gathers what the venue needs to quote, and when the venue is booked
 * out or too small, offers available venues nearby in the network, so the
 * corporate lead isn't lost. With no AI model configured it still reads the
 * details and answers from templates (lib/venues/inquiry.ts).
 *
 * The visitor continues the conversation with a random token; only its
 * SHA-256 is stored. The venue hears about a lead once it's qualified.
 */

export class InquiryVenueNotFoundError extends Error {}

export interface InquiryTurn {
  token: string;
  reply: string;
  status: InquiryStatus;
  details: LeadDetails;
  availability: "available" | "unavailable" | null;
  alternatives: (NetworkVenue & { link: string })[];
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const inquiryLink = (venueId: string) => `${siteUrl("http://localhost:3000")}/inquire/${venueId}`;

const detailsOf = (r: InquiryRow | null): LeadDetails =>
  r
    ? {
        contact_name: r.contact_name,
        contact_email: r.contact_email,
        contact_phone: r.contact_phone,
        company_name: r.company_name,
        party_size: r.party_size,
        event_date: r.event_date,
        budget_per_head_inr: r.budget_per_head_inr,
        occasion: r.occasion,
      }
    : { ...EMPTY_DETAILS };

/** What the venue offers, for the model: capacity, room, packages, minimums. */
function factsText({ venue: v, packages }: VenueFacts): string {
  return [
    `${v.name}, ${v.neighborhood}, ${v.city}. ${v.address}`,
    `Seats up to ${v.capacity_max}.${v.pdr_available ? " Has a private dining room." : ""}${v.serves_alcohol ? " Serves alcohol." : " No alcohol."}`,
    `Minimum spend ₹${Number(v.min_spend_inr).toLocaleString("en-IN")}${v.min_spend_per_head_inr ? `, or ₹${Number(v.min_spend_per_head_inr).toLocaleString("en-IN")} per head` : ""} (before GST; GST is 18% on top).`,
    ...(Array.isArray(v.entertainment) && v.entertainment.length ? [`Entertainment: ${v.entertainment.join(", ")}.`] : []),
    packages.length
      ? `Menu packages (per head, before GST): ${packages.map((p) => `${p.name} ₹${p.per_head_inr.toLocaleString("en-IN")}${p.dietary_tags.length ? ` (${p.dietary_tags.join(", ")})` : ""}${p.description ? `: ${p.description}` : ""}`).join("; ")}.`
      : "Menu packages: the venue team shares them on request.",
  ].join("\n");
}

/** Free that day, and if not (or too small), up to three available venues nearby. */
async function checkDate(facts: VenueFacts, date: string, partySize: number | null) {
  const { venue } = facts;
  const fits = !partySize || partySize <= venue.capacity_max;
  const available = (await checkHoldAvailability({ venue_id: venue.id, from: date, to: date })).available;
  let alternatives: NetworkVenue[] = [];
  if (!available || !fits) {
    const network = await networkVenues();
    const origin = network.find((v) => v.id === venue.id)!;
    // Check the likeliest candidates (same city, big enough, nearest) until three are free.
    const candidates = rankAlternatives(origin, network, { partySize, available: new Set(network.map((v) => v.id)) }, 10);
    const free = new Set<string>();
    for (const c of candidates) {
      if (free.size >= MAX_ALTERNATIVES) break;
      if ((await checkHoldAvailability({ venue_id: c.id, from: date, to: date })).available) free.add(c.id);
    }
    alternatives = rankAlternatives(origin, network, { partySize, available: free });
  }
  return { available, fits, alternatives };
}

export async function handleInquiryTurn(input: { venueId: string; token?: string | null; message: string; today?: string }): Promise<InquiryTurn> {
  const facts = await venueFacts(input.venueId);
  if (!facts) throw new InquiryVenueNotFoundError("This venue isn't taking inquiries.");
  const today = input.today ?? todayInIndia();
  const message = input.message.trim().slice(0, MAX_MESSAGE_CHARS);

  // A token from another venue, or a made-up one, starts a new conversation rather than failing.
  let token = input.token && TOKEN.test(input.token) ? input.token : null;
  const existing = token ? await findInquiry(input.venueId, sha256(token)) : null;
  if (!existing) token = newToken();

  let details = mergeDetails(detailsOf(existing), extractDetails(message, today));
  let availability: InquiryTurn["availability"] = null;
  let fits = true;
  let alternatives: NetworkVenue[] = [];
  const runCheck = async (date: string, partySize: number | null) => {
    const r = await checkDate(facts, date, partySize);
    availability = r.available ? "available" : "unavailable";
    fits = r.fits;
    alternatives = r.alternatives;
    return r;
  };
  if (details.event_date && details.event_date >= today) await runCheck(details.event_date, details.party_size);

  const model = getLanguageModel({ usage: { agent: "venue-inquiry", source: "inquiry" } });
  let reply: string;
  if (model) {
    const state = () =>
      [
        `Details: ${JSON.stringify(details)}`,
        `Still needed: ${missingDetails(details).join(", ") || "nothing"}`,
        availability ? `On ${details.event_date}: ${availability === "available" ? "free" : "booked"}${fits ? "" : `, and ${details.party_size} guests is over capacity`}.` : "No date checked yet.",
        alternatives.length ? `Available alternatives: ${alternatives.map((v) => `${v.name} (${v.neighborhood}, up to ${v.capacity_max}${v.from_per_head_inr ? `, from ₹${v.from_per_head_inr}/head` : ""}) ${inquiryLink(v.id)}`).join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    const history = (existing?.messages ?? []).map((m) => ({ role: m.role === "visitor" ? ("user" as const) : ("assistant" as const), content: m.text }));
    // A provider outage costs the visitor the model's wording, not their answer: the template reply below.
    const result = await tracer.trace("llm.generate", async (span) => {
      const r = await generateText({
        model,
        system: venueInquirySystem({ venueName: facts.venue.name, today, facts: factsText(facts), state: state() }),
        messages: [...history, { role: "user", content: message }],
        tools: {
          recordLeadDetails: tool({
            description: "Save details the visitor stated. Only include fields they gave.",
            inputSchema: z.object({
              contact_name: z.string().max(120).optional(),
              contact_email: z.string().max(254).optional(),
              contact_phone: z.string().max(30).optional(),
              company_name: z.string().max(200).optional(),
              party_size: z.number().int().min(1).max(5000).optional(),
              event_date: z.iso.date().optional(),
              budget_per_head_inr: z.number().positive().max(100_000).optional(),
              occasion: z.string().max(200).optional(),
            }),
            execute: async (d) => {
              details = mergeDetails(details, { ...d, contact_phone: d.contact_phone ? normalizePhone(d.contact_phone) || undefined : undefined });
              return { saved: true, stillNeeded: missingDetails(details) };
            },
          }),
          checkDate: tool({
            description: "Check whether the venue is free on a date (YYYY-MM-DD) for a party size; returns available alternatives nearby if not.",
            inputSchema: z.object({ date: z.iso.date(), partySize: z.number().int().min(1).max(5000).optional() }),
            execute: async ({ date, partySize }) => {
              if (date < today) return { error: "That date has passed." };
              details = mergeDetails(details, { event_date: date, party_size: partySize ?? null });
              const r = await runCheck(date, details.party_size);
              return {
                date: formatEventDate(date),
                available: r.available,
                fitsParty: r.fits,
                capacityMax: facts.venue.capacity_max,
                alternatives: r.alternatives.map((v) => ({ name: v.name, area: v.neighborhood, seats: v.capacity_max, fromPerHead: v.from_per_head_inr, link: inquiryLink(v.id) })),
              };
            },
          }),
        },
        stopWhen: isStepCount(4),
        temperature: 0.3,
      });
      span.setAttributes({ model: r.response.modelId, tokens: r.totalUsage.totalTokens, steps: r.steps.length });
      return r;
    }).catch((err) => {
      console.error("inquiries: model turn failed; answering from templates", err);
      return null;
    });
    reply = result?.text.trim() ?? "";
  } else {
    reply = "";
  }
  // No model, or it said nothing: the template reply from what's known.
  if (!reply) reply = fallbackReply({ venueName: facts.venue.name, details, availability, capacityMax: facts.venue.capacity_max, alternatives, altLink: inquiryLink });

  const now = new Date().toISOString();
  const qualified = isQualified(details);
  const referred = alternatives.length > 0 && (availability === "unavailable" || !fits);
  const prevStatus = existing?.status ?? "open";
  const status = nextStatus(prevStatus, { qualified, referred });
  const saved = await saveInquiry(input.venueId, sha256(token!), existing?.id ?? null, {
    ...details,
    status,
    date_available: availability === null ? (existing?.date_available ?? null) : availability === "available",
    referred_venue_ids: [...new Set([...(existing?.referred_venue_ids ?? []), ...alternatives.map((v) => v.id)])],
    messages: appendTurns(existing?.messages ?? [], { role: "visitor", text: message, at: now }, { role: "agent", text: reply, at: now }),
    qualified_at: existing?.qualified_at ?? (qualified ? now : null),
  });

  // The venue hears about each lead once, when it first has what's needed to quote.
  if (qualified && !existing?.qualified_at) notifyVenue(facts, saved);

  return { token: token!, reply, status, details, availability, alternatives: alternatives.map((v) => ({ ...v, link: inquiryLink(v.id) })) };
}

/** WhatsApp to the venue's alert number (the one it set for escalations), after the response. Never throws. */
function notifyVenue(facts: VenueFacts, inquiry: InquiryRow) {
  if (!whatsAppProvider()) return;
  const work = (async () => {
    const to = await venueAlertNumber(facts.venue.id).catch(() => null);
    if (!to) return;
    const who = [inquiry.contact_name, inquiry.company_name].filter(Boolean).join(", ");
    const what = [inquiry.party_size ? `${inquiry.party_size} guests` : null, inquiry.event_date ? formatEventDate(inquiry.event_date) : null, inquiry.budget_per_head_inr ? `₹${inquiry.budget_per_head_inr}/head` : null].filter(Boolean).join(" · ");
    const reach = inquiry.contact_email ?? inquiry.contact_phone ?? "";
    await sendWhatsAppMessage(to, `New corporate inquiry for ${facts.venue.name}: ${who}. ${what}. Reply to ${reach}, or see it in Lufer.ai: ${siteUrl("http://localhost:3000")}/property?tab=inquiries`);
  })().catch((err) => console.error("inquiries: venue alert failed", err));
  try {
    after(work);
  } catch {
    // Outside a request (tests, scripts): the promise still runs.
  }
}
