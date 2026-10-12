"use server";

import { revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { confirmBooking } from "@/lib/bookings/confirm";
import { addBlockedDates, BlockedDatesUnavailableError, releaseHold, removeBlockedDate, updateBookingStatus } from "@/lib/data";
import { dispatchBookingConfirmed } from "@/lib/finance/export-dispatcher";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { settleDeposit } from "@/lib/payments/service";
import { parseRules } from "@/lib/rfp/guardrails";
import { saveNegotiationRules } from "@/lib/rfp/rules-store";
import { createDirectQuote, GuardrailError, isMissingColumn, respondToRfp } from "@/lib/rfp/service";
import { todayInIndia } from "@/lib/gst-engine";
import type { BookingStatus } from "@/lib/supabase/database.types";

const INTENT_TO_STATUS: Record<string, BookingStatus> = {
  approve: "CONFIRMED",
  decline: "CANCELLED",
  complete: "COMPLETED",
};

/** The acting venue: a property manager's own; admins may pass one. */
async function actingVenueId(formData: FormData): Promise<string> {
  return (await actingVenue(formData)).venueId;
}

async function actingVenue(formData: FormData): Promise<{ venueId: string; userId: string }> {
  const member = await requirePortal("/property");
  // Never trust the submitted venue for property managers.
  return { venueId: member.role === "ADMIN" ? String(formData.get("venue_id") ?? "") : (member.venueId ?? ""), userId: member.userId };
}

/** What the host forms show after submitting (useActionState). */
export interface HostFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

/** Guardrail and validation messages go to the host; anything else is logged and kept generic. */
function failure(scope: string, err: unknown): HostFormState {
  if (err instanceof GuardrailError || err instanceof BlockedDatesUnavailableError) return { status: "error", message: err.message };
  if (isMissingColumn(err as { code?: string })) return { status: "error", message: "Direct quotes need database migration 0025. Ask an admin to apply it." };
  if (err instanceof Error && /^(RFP not found|This RFP is closed|Enter a per-head price|Unknown menu package|Guardrails need)/.test(err.message)) return { status: "error", message: err.message };
  console.error(`property: ${scope} failed`, err);
  return { status: "error", message: "Something went wrong. Try again." };
}

function revalidateHostViews() {
  revalidatePath("/property");
  revalidatePath("/client");
}

/** Approve / decline / complete a booking on behalf of the acting venue. */
export async function respondToBooking(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const bookingId = String(formData.get("booking_id") ?? "");
  const next = INTENT_TO_STATUS[String(formData.get("intent") ?? "")];
  if (!bookingId || !venueId || !next) throw new Error("Invalid booking action");

  // Scoped to the venue so one property can never update another's booking. The
  // bookings_sync_inventory_holds trigger converts/releases the date hold.
  if (next === "CONFIRMED") {
    // Status, expense export and deposit capture (lib/bookings/confirm.ts).
    await confirmBooking(bookingId, venueId);
  } else {
    await updateBookingStatus(bookingId, next, { venueId });
    // Declining releases the client's deposit.
    if (next === "CANCELLED") await settleDeposit(bookingId, "void");
  }

  revalidatePath("/property");
  revalidatePath("/client");
  revalidatePath("/admin");
}

/** Releases one of the acting venue's live holds early, freeing the date. */
export async function releaseVenueHold(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const holdId = String(formData.get("hold_id") ?? "");
  if (!holdId || !venueId) throw new Error("Invalid hold action");

  await releaseHold(holdId, { venueId });

  revalidatePath("/property");
  revalidatePath("/client");
}

/**
 * Converts a hold by confirming its booking: the bookings_sync_inventory_holds
 * trigger (mirrored in mock mode) marks the hold CONVERTED.
 */
export async function convertVenueHold(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const bookingId = String(formData.get("booking_id") ?? "");
  if (!bookingId || !venueId) throw new Error("Invalid hold action");

  await updateBookingStatus(bookingId, "CONFIRMED", { venueId });
  await dispatchBookingConfirmed(bookingId);
  await settleDeposit(bookingId, "capture");

  revalidatePath("/property");
  revalidatePath("/client");
  revalidatePath("/admin");
}

/** Counter-offer (per-head price, optional package) or decline on an RFP sent to this venue. */
export async function respondToRfpAction(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const responseId = String(formData.get("response_id") ?? "");
  const decline = formData.get("intent") === "decline";
  if (!venueId || !responseId) throw new Error("Invalid RFP response");

  await respondToRfp({
    responseId,
    venueId,
    decline,
    perHeadInr: Number(formData.get("per_head_inr")) || undefined,
    menuPackageId: String(formData.get("menu_package_id") ?? "") || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  revalidatePath("/property");
  revalidatePath("/client");
}

/** Counter or decline from the RFP inbox, with guardrail errors shown inline. */
export async function counterRfpAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const venueId = await actingVenueId(formData);
    const responseId = String(formData.get("response_id") ?? "");
    const decline = formData.get("intent") === "decline";
    if (!venueId || !responseId) return { status: "error", message: "Invalid RFP response." };
    await respondToRfp({
      responseId,
      venueId,
      decline,
      perHeadInr: Number(formData.get("per_head_inr")) || undefined,
      menuPackageId: String(formData.get("menu_package_id") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    revalidateHostViews();
    return { status: "success", message: decline ? "Declined." : "Counter-offer sent." };
  } catch (err) {
    return failure("counter", err);
  }
}

/** Longest range one "Block dates" submit may cover. */
const MAX_BLOCK_DAYS = 62;

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/**
 * Marks dates unavailable at the acting venue. Dates already held or booked
 * can't be blocked (release or decline them first); ones already blocked are
 * skipped.
 */
export async function blockDatesAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const { venueId, userId } = await actingVenue(formData);
    const from = String(formData.get("from") ?? "");
    const to = String(formData.get("to") ?? "") || from;
    const reason = String(formData.get("reason") ?? "").trim().slice(0, 120) || null;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!venueId) return { status: "error", message: "Choose a venue." };
    if (!iso.test(from) || !iso.test(to)) return { status: "error", message: "Pick the dates to block." };
    if (to < from) return { status: "error", message: "The end date is before the start date." };
    if (from < todayInIndia()) return { status: "error", message: "Past dates can't be blocked." };
    const dates = datesBetween(from, to);
    if (dates.length > MAX_BLOCK_DAYS) return { status: "error", message: `Block at most ${MAX_BLOCK_DAYS} days at a time.` };

    const { locks } = await checkHoldAvailability({ venue_id: venueId, from, to });
    const taken = locks.filter((l) => l.kind !== "BLOCKED");
    if (taken.length) {
      const list = [...new Set(taken.map((l) => l.date))].join(", ");
      return { status: "error", message: `Already held or booked: ${list}. Release or decline those first.` };
    }
    const added = await addBlockedDates(venueId, dates, reason, userId);
    revalidateHostViews();
    const skipped = dates.length - added.length;
    return {
      status: "success",
      message: `Blocked ${added.length} date${added.length === 1 ? "" : "s"}${skipped ? ` (${skipped} already blocked)` : ""}. Clients can't request them now.`,
    };
  } catch (err) {
    return failure("block dates", err);
  }
}

/** Unblocks one date. */
export async function unblockDateAction(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const blockId = String(formData.get("block_id") ?? "");
  if (!venueId || !blockId) throw new Error("Invalid unblock action");
  await removeBlockedDate(blockId, { venueId });
  revalidateHostViews();
}

/** Saves the negotiator guardrails for the acting venue. */
export async function saveGuardrailsAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const { venueId, userId } = await actingVenue(formData);
    if (!venueId) return { status: "error", message: "Choose a venue." };
    const parsed = parseRules({
      minSpendFloor: String(formData.get("min_spend_floor") ?? ""),
      maxDiscountPct: String(formData.get("max_discount_pct") ?? ""),
      autoCounter: formData.get("auto_counter") === "on",
      autoDeclineBelowFloor: formData.get("auto_decline") === "on",
    });
    if (!parsed.ok) return { status: "error", message: parsed.error };
    await saveNegotiationRules(venueId, parsed.value, userId);
    revalidatePath("/property");
    return { status: "success", message: "Guardrails saved. They apply to counters, direct quotes, the AI negotiator and new RFPs." };
  } catch (err) {
    return failure("save guardrails", err);
  }
}

/** Sends a direct quote to a client company the venue works with. */
export async function createDirectQuoteAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const { venueId, userId } = await actingVenue(formData);
    if (!venueId) return { status: "error", message: "Choose a venue." };
    const companyId = String(formData.get("company_id") ?? "");
    if (!companyId) return { status: "error", message: "Choose the client." };
    await createDirectQuote({
      venueId,
      companyId,
      createdBy: userId,
      eventDate: String(formData.get("event_date") ?? ""),
      partySize: Number(formData.get("party_size")),
      perHeadInr: Number(formData.get("per_head_inr")),
      menuPackageId: String(formData.get("menu_package_id") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim().slice(0, 280) || null,
      today: todayInIndia(),
    });
    revalidateHostViews();
    return { status: "success", message: "Quote sent. It's in the client's RFP comparisons, where they can book it." };
  } catch (err) {
    return failure("direct quote", err);
  }
}
