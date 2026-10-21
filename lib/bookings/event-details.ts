/**
 * Extra event details the manual booking form collects (occasion, timings,
 * seating, food and drink, dietary needs, a budget cap). Bookings have no
 * columns for them, so they travel to the venue as a structured preamble in
 * the request's notes, which placeBookingRequest stores and the venue sees.
 *
 * Pure (no server imports), so the browser, the server action and
 * tests/event-details.test.mjs share it.
 */
import { NOTES_MAX } from "./request-schema.ts";

export const OCCASIONS = ["Team dinner", "Team lunch", "Executive offsite", "Client dinner", "Celebration", "Town hall", "Workshop"] as const;
export const SEATING = { private: "Private dining", open: "Open section" } as const;
export const FOOD = { veg: "Veg", non_veg: "Non-veg", alcohol: "Alcohol" } as const;

export type Seating = keyof typeof SEATING;
export type Food = keyof typeof FOOD;

export interface EventDetails {
  occasion: string;
  startTime: string; // HH:MM, may be ""
  endTime: string;
  seating: Seating | "";
  food: Food[];
  dietary: string;
  /** ₹ pre-tax ceiling for the whole event; "" for none. */
  budgetCap: string;
}

export const EMPTY_EVENT_DETAILS: EventDetails = { occasion: "", startTime: "", endTime: "", seating: "", food: [], dietary: "", budgetCap: "" };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/**
 * The notes sent with the request: one line per detail given, then the user's
 * own notes. Empty details add nothing, so a plain request's notes are unchanged.
 */
export function composeEventNotes(details: EventDetails, notes: string): string {
  const lines: string[] = [];
  const occasion = details.occasion.trim();
  if (occasion) lines.push(`Occasion: ${occasion}`);
  const start = details.startTime.trim();
  const end = details.endTime.trim();
  if (start || end) lines.push(`Time: ${start || "?"}–${end || "?"}`);
  if (details.seating) lines.push(`Seating: ${SEATING[details.seating]}`);
  if (details.food.length) lines.push(`Food & drink: ${details.food.map((f) => FOOD[f]).join(", ")}`);
  const dietary = details.dietary.trim();
  if (dietary) lines.push(`Dietary: ${dietary}`);
  const cap = Number(details.budgetCap);
  if (details.budgetCap.trim() && cap > 0) lines.push(`Budget cap: ₹${INR.format(cap)} (pre-tax)`);
  const rest = notes.trim();
  return [lines.join("\n"), rest].filter(Boolean).join("\n\n");
}

/** Field-level problems with the details themselves (format, order, room left for notes). */
export function eventDetailsErrors(details: EventDetails, notes: string): Partial<Record<"startTime" | "endTime" | "budgetCap" | "notes", string>> {
  const errors: Partial<Record<"startTime" | "endTime" | "budgetCap" | "notes", string>> = {};
  if (details.startTime && !TIME.test(details.startTime)) errors.startTime = "Use a time like 19:30";
  if (details.endTime && !TIME.test(details.endTime)) errors.endTime = "Use a time like 22:00";
  // Same-day events: the end comes after the start.
  if (!errors.startTime && !errors.endTime && details.startTime && details.endTime && details.endTime <= details.startTime) errors.endTime = "Ends after it starts";
  if (details.budgetCap.trim() && !(Number(details.budgetCap) > 0)) errors.budgetCap = "Enter an amount in ₹, or leave blank";
  if (composeEventNotes(details, notes).length > NOTES_MAX) errors.notes = `Details and notes together: up to ${NOTES_MAX} characters`;
  return errors;
}

/**
 * The request's pre-tax total against the cap (null when within it or no cap).
 * Server and browser both check guests × per-head budget, the figure the user asks for.
 */
export function budgetCapError(input: { partySize: number; perHead: number; cap: number | null }): string | null {
  const { partySize, perHead, cap } = input;
  if (cap == null || !(cap > 0) || !(partySize > 0) || !(perHead > 0)) return null;
  const total = partySize * perHead;
  return total > cap ? `${partySize} guests × ₹${INR.format(perHead)} is ₹${INR.format(total)}, over your ₹${INR.format(cap)} cap. Lower the guests or the per-head budget, or raise the cap.` : null;
}
