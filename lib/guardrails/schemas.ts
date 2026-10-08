/**
 * Input schemas for the AI tools that change data, and the limits the guardrail
 * engine (./engine.ts) enforces on them. The tools import their inputSchema from
 * here, so what the model may send and what the engine checks can't drift apart.
 *
 * Read-only tools (venue search, metrics, spend analysis, forecasts) keep their
 * schemas next to their implementations.
 *
 * Pure (no server imports), so tests/guardrails.test.mjs can use it.
 */
import { z } from "zod";

import { DIETARY_TAGS } from "../quotes.ts";

/** One place to tune the guardrails. */
export const GUARDRAIL_LIMITS = {
  booking: {
    /** Bookings one WhatsApp/Slack sender can file per rolling hour. */
    perSenderPerHour: 3,
    /** How far ahead an AI-filed booking may be. */
    maxDaysAhead: 365,
    /** A second request for the same venue and date from the same sender is refused for this long. */
    duplicateWindowHours: 24,
  },
  minimumSpend: {
    /** Largest change one approved call may make, as a fraction of the current value. */
    maxChangeFraction: 0.5,
  },
  menuPackage: {
    minPerHeadInr: 100,
    maxPerHeadInr: 50_000,
  },
} as const;

/** WhatsApp/Slack concierge: file a booking request at a catalogue venue. */
export const createBookingInput = z.object({
  venueName: z.string().trim().min(1).max(120).describe("Venue name exactly as in the catalogue."),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
  partySize: z.number().int().min(1).max(5000),
  budgetPerHead: z.number().positive().max(1_000_000).describe("INR per guest, pre-GST."),
  notes: z.string().max(500).optional(),
  costCenter: z.string().max(32).optional().describe("Cost centre if the sender named one; otherwise their default is used."),
  projectCode: z.string().max(32).optional().describe("Project code if the sender named one."),
});

/** Venue pricing assistant: change the venue's minimum spend. */
export const setMinimumSpendInput = z.object({
  min_spend_inr: z.number().min(0).max(10_000_000),
  reason: z.string().min(1).max(280).describe("Why this change, in one sentence, for the host to review"),
});

/** Venue pricing assistant: create or update a menu package. */
export const upsertMenuPackageInput = z.object({
  package_id: z.uuid().nullable().describe("Existing package id to update, or null to create"),
  name: z.string().trim().min(1).max(80),
  per_head_inr: z.number().positive().max(100_000),
  dietary_tags: z.array(z.enum(DIETARY_TAGS)).max(DIETARY_TAGS.length),
  description: z.string().max(280).nullable(),
  is_active: z.boolean(),
  reason: z.string().min(1).max(280).describe("Why this change, in one sentence, for the host to review"),
});

export type CreateBookingInput = z.infer<typeof createBookingInput>;
export type SetMinimumSpendInput = z.infer<typeof setMinimumSpendInput>;
export type UpsertMenuPackageInput = z.infer<typeof upsertMenuPackageInput>;

export const MUTATING_TOOLS = {
  createBooking: createBookingInput,
  setMinimumSpend: setMinimumSpendInput,
  upsertMenuPackage: upsertMenuPackageInput,
} as const;
export type MutatingTool = keyof typeof MUTATING_TOOLS;
