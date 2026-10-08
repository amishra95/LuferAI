/**
 * The booking request form's schema, shared by the browser (per-step checks as
 * the user goes) and submitBookingRequest (authoritative, before anything is
 * written). Same rules and messages on both sides.
 *
 * It covers shape and format. Checks that need data stay in
 * placeBookingRequest, which every entry point (portal, WhatsApp, Slack) uses:
 * the requester's role, the venue's capacity and minimum spend, that the
 * department and billing GSTIN belong to the company, policy and the date hold.
 * Pass `capacity` / `companyGstin` to run those two checks early in the browser.
 *
 * Pure (no server imports), so tests/booking-request-schema.test.mjs can use it.
 */
import { z } from "zod";

import { validateExpense, type ExpenseField } from "./expense.ts";

export type BookingFormField = "venue_id" | "event_date" | "party_size" | "budget_per_head_inr" | "department_id" | "notes" | ExpenseField;

export const BOOKING_STEPS = [
  { id: "event", title: "Event", fields: ["venue_id", "event_date", "party_size", "budget_per_head_inr"] },
  { id: "billing", title: "Billing", fields: ["department_id", "cost_center", "project_code", "billing_gstin", "notes"] },
  { id: "review", title: "Review", fields: [] },
] as const satisfies readonly { id: string; title: string; fields: readonly BookingFormField[] }[];

export type BookingStepId = (typeof BOOKING_STEPS)[number]["id"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOTES_MAX = 500;

/** Form values arrive as strings (FormData or controlled inputs). */
const text = z.string().trim();

export interface BookingSchemaContext {
  /** YYYY-MM-DD; the event must be after it. Same "today" as placeBookingRequest (UTC). */
  today: string;
  /** Selected venue's capacity, when known (browser). */
  capacity?: number;
  venueName?: string;
  /** The company's registered GSTIN, when known: enables the same-legal-entity check. */
  companyGstin?: string;
}

export function bookingRequestSchema(ctx: BookingSchemaContext) {
  return z
    .object({
      venue_id: text.regex(UUID, "Choose a venue"),
      event_date: text.regex(ISO_DATE, "Pick a future date").refine((d) => d > ctx.today, "Pick a future date"),
      party_size: text
        .regex(/^\d+$/, "Enter a whole number of guests")
        .transform(Number)
        .refine((n) => n >= 1, "Enter a whole number of guests")
        .refine((n) => ctx.capacity === undefined || n <= ctx.capacity, `${ctx.venueName ?? "This venue"} seats up to ${ctx.capacity}`),
      budget_per_head_inr: text
        .min(1, "Enter a budget per head")
        .transform(Number)
        .refine((n) => Number.isFinite(n) && n > 0, "Enter a budget per head"),
      department_id: text.refine((v) => v === "" || UUID.test(v), "Choose a department").transform((v) => v || null),
      cost_center: text,
      project_code: text,
      billing_gstin: text,
      notes: text.max(NOTES_MAX, `Notes: up to ${NOTES_MAX} characters`).transform((v) => v || undefined),
    })
    .superRefine((v, issue) => {
      // The expense rules finance relies on, shared with placeBookingRequest. Without the
      // company's GSTIN only the format is checked here; the server checks the entity.
      const companyGstin = ctx.companyGstin || v.billing_gstin;
      const expense = validateExpense({ costCenter: v.cost_center, projectCode: v.project_code, taxId: v.billing_gstin }, companyGstin);
      if (!expense.ok) for (const [path, message] of Object.entries(expense.errors)) issue.addIssue({ code: "custom", path: [path], message });
    });
}

export type BookingRequestValues = z.output<ReturnType<typeof bookingRequestSchema>>;
export type BookingFormInput = Record<BookingFormField, string>;

/** First message per field, from a failed parse. */
export function fieldErrorsOf(error: z.ZodError): Partial<Record<BookingFormField, string>> {
  const out: Partial<Record<BookingFormField, string>> = {};
  for (const i of error.issues) {
    const field = i.path[0] as BookingFormField | undefined;
    if (field && !out[field]) out[field] = i.message;
  }
  return out;
}

/** Validates the whole form: the parsed values, or the first error per field. */
export function validateBookingForm(
  input: BookingFormInput,
  ctx: BookingSchemaContext
): { ok: true; value: BookingRequestValues } | { ok: false; errors: Partial<Record<BookingFormField, string>> } {
  const parsed = bookingRequestSchema(ctx).safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: fieldErrorsOf(parsed.error) };
}

/** Errors on one step's fields only (empty when the step is complete). */
export function validateBookingStep(input: BookingFormInput, ctx: BookingSchemaContext, step: BookingStepId): Partial<Record<BookingFormField, string>> {
  const result = validateBookingForm(input, ctx);
  if (result.ok) return {};
  const fields = new Set<string>(BOOKING_STEPS.find((s) => s.id === step)!.fields);
  return Object.fromEntries(Object.entries(result.errors).filter(([f]) => fields.has(f)));
}

/** The step a field is entered on, to send the user back to the first error. */
export function stepOf(field: string): BookingStepId {
  return BOOKING_STEPS.find((s) => (s.fields as readonly string[]).includes(field))?.id ?? "event";
}

/** Reads the form's fields from FormData as strings (missing → ""). */
export function bookingFormInput(formData: FormData): BookingFormInput {
  const get = (k: BookingFormField) => String(formData.get(k) ?? "");
  return {
    venue_id: get("venue_id"),
    event_date: get("event_date"),
    party_size: get("party_size"),
    budget_per_head_inr: get("budget_per_head_inr"),
    department_id: get("department_id"),
    cost_center: get("cost_center"),
    project_code: get("project_code"),
    billing_gstin: get("billing_gstin"),
    notes: get("notes"),
  };
}
