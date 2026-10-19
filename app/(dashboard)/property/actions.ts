"use server";

import { revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { confirmBooking } from "@/lib/bookings/confirm";
import { acknowledgeEventPlan, addBlockedDates, BlockedDatesUnavailableError, EventWorkspaceError, releaseHold, removeBlockedDate, updateBookingStatus } from "@/lib/data";
import { dispatchBookingConfirmed } from "@/lib/finance/export-dispatcher";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { settleDeposit } from "@/lib/payments/service";
import { parseCancellationRows, parseDepositPct, parseMultiplierForm, parseTierRows, PRICING_LIMITS } from "@/lib/rates/venue-pricing";
import { parseRules } from "@/lib/rfp/guardrails";
import { getNegotiationRules, saveNegotiationRules } from "@/lib/rfp/rules-store";
import { createDirectQuote, GuardrailError, isMissingColumn, respondToRfp } from "@/lib/rfp/service";
import { todayInIndia } from "@/lib/gst-engine";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { tracer } from "@/lib/tracer";
import { getVenuePricing, PricingError, saveCancellationTerms, saveMenuPackage, saveMinimumSpend, saveVenuePricing } from "@/lib/venues/pricing-store";

const INTENT_TO_STATUS: Record<string, BookingStatus> = {
  approve: "CONFIRMED",
  decline: "CANCELLED",
  complete: "COMPLETED",
};

/** The acting venue: a property manager's own; admins may pass one. */
async function actingVenueId(formData: FormData): Promise<string> {
  return (await actingVenue(formData)).venueId;
}

async function actingVenue(formData: FormData): Promise<{ venueId: string; userId: string; role: string }> {
  const member = await requirePortal("/property");
  // Never trust the submitted venue for property managers.
  return { venueId: member.role === "ADMIN" ? String(formData.get("venue_id") ?? "") : (member.venueId ?? ""), userId: member.userId, role: member.role };
}

/** What the host forms show after submitting (useActionState). */
export interface HostFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

/** Guardrail and validation messages go to the host; anything else is logged and kept generic. */
function failure(scope: string, err: unknown): HostFormState {
  if (err instanceof GuardrailError || err instanceof BlockedDatesUnavailableError || err instanceof PricingError) return { status: "error", message: err.message };
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
  const { venueId, userId, role } = await actingVenue(formData);
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
    actor: { id: userId, role },
  });

  revalidatePath("/property");
  revalidatePath("/client");
}

/** Counter or decline from the RFP inbox, with guardrail errors shown inline. */
export async function counterRfpAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const { venueId, userId, role } = await actingVenue(formData);
    const responseId = String(formData.get("response_id") ?? "");
    const decline = formData.get("intent") === "decline";
    if (!venueId || !responseId) return { status: "error", message: "Invalid RFP response." };
    const perHeadInr = Number(formData.get("per_head_inr")) || undefined;
    // The host's own counter/decline: the human side of the negotiation trace on /agents.
    await tracer.trace(
      "negotiation.respond",
      async (span) => {
        try {
          await respondToRfp({
            responseId,
            venueId,
            decline,
            perHeadInr,
            menuPackageId: String(formData.get("menu_package_id") ?? "") || null,
            notes: String(formData.get("notes") ?? "").trim() || null,
            actor: { id: userId, role },
          });
        } catch (err) {
          // The venue's own guardrails (floor, discount ceiling) refused the counter.
          if (err instanceof GuardrailError) span.setAttribute("decision", "deny");
          throw err;
        }
      },
      { attributes: { venueId, response: responseId.slice(0, 8), intent: decline ? "decline" : "counter", perHeadInr: decline ? null : (perHeadInr ?? null) } }
    );
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

/** The venue confirms it has the client's signed-off event plan. */
export async function acknowledgePlanAction(formData: FormData) {
  const member = await requirePortal("/property");
  const venueId = await actingVenueId(formData);
  const bookingId = String(formData.get("booking_id") ?? "");
  const revision = Number(formData.get("revision"));
  if (!venueId || !bookingId || !Number.isInteger(revision)) throw new Error("Invalid acknowledgement");
  try {
    await acknowledgeEventPlan(bookingId, venueId, revision, member.userId);
  } catch (err) {
    // Already-acknowledged or superseded plans just refresh to the current state.
    if (!(err instanceof EventWorkspaceError)) throw err;
  }
  revalidatePath("/property");
  revalidatePath(`/client/events/${bookingId}`);
}

// ----------------------------------------------------------------------------
// Pricing tab: the host's manual pricing controls (lib/venues/pricing-store)
// ----------------------------------------------------------------------------

const MAX_MIN_SPEND_INR = 10_000_000;

const amount = (formData: FormData, name: string) => {
  const text = String(formData.get(name) ?? "").trim().replace(/[₹,\s]/g, "");
  return text === "" ? 0 : Number(text);
};

/** Parallel form arrays (name="tier_min" repeated) as rows. */
const rows = <K extends string>(formData: FormData, fields: Record<K, string>): Record<K, string>[] => {
  const columns = Object.entries(fields).map(([key, name]) => [key, formData.getAll(name as string).map(String)] as const);
  const length = Math.max(0, ...columns.map(([, values]) => values.length));
  return Array.from({ length }, (_, i) => Object.fromEntries(columns.map(([key, values]) => [key, values[i] ?? ""])) as Record<K, string>);
};

function revalidatePricing() {
  revalidatePath("/property");
  revalidatePath("/client");
}

/** Minimum spend, per-guest minimum, guest-count tiers, and whether the AI may change the minimum spend. */
export async function saveMinimumSpendAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const { venueId, userId } = await actingVenue(formData);
    if (!venueId) return { status: "error", message: "Choose a venue." };
    const minSpend = amount(formData, "min_spend_inr");
    const minPerHead = amount(formData, "min_spend_per_head_inr");
    if (!Number.isFinite(minSpend) || minSpend < 0 || minSpend > MAX_MIN_SPEND_INR) return { status: "error", message: "Enter a minimum spend between ₹0 and ₹1,00,00,000." };
    if (!Number.isFinite(minPerHead) || minPerHead < 0 || minPerHead > 100_000) return { status: "error", message: "Enter a per-guest minimum between ₹0 and ₹1,00,000." };
    const tiers = parseTierRows(rows(formData, { min: "tier_min", max: "tier_max", pct: "tier_pct" }));
    if (!tiers.ok) return { status: "error", message: tiers.error };
    const { rules } = await getNegotiationRules(venueId);
    if (rules.minSpendFloor != null && minSpend < rules.minSpendFloor) {
      return { status: "error", message: `That's below your own ₹${rules.minSpendFloor.toLocaleString("en-IN")} minimum spend floor (Guardrails). Lower the floor first, or set ₹${rules.minSpendFloor.toLocaleString("en-IN")} or more.` };
    }
    const lock = formData.get("lock_min_spend") === "on";
    const { ready } = await getVenuePricing(venueId);
    // Before migration 0027 only the venue's own columns can be saved; say so rather than drop tiers or the lock.
    if (!ready && (tiers.value.length > 0 || lock)) {
      return { status: "error", message: "Guest-count tiers and the AI lock need database migration 0027. Clear them to save the minimums alone, or ask an admin to apply it." };
    }
    if (ready) await saveVenuePricing(venueId, { tiers: tiers.value, lockMinSpend: lock }, userId);
    await saveMinimumSpend(venueId, { minSpendInr: Math.round(minSpend), minPerHeadInr: Math.round(minPerHead) });
    revalidatePricing();
    return { status: "success", message: "Saved. New quotes use these minimums and tiers." };
  } catch (err) {
    return failure("save minimum spend", err);
  }
}

/** Creates or edits one menu package, and whether the AI may change it. */
export async function savePackageAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const { venueId, userId } = await actingVenue(formData);
    if (!venueId) return { status: "error", message: "Choose a venue." };
    const packageId = String(formData.get("package_id") ?? "") || null;
    const { pricing, ready } = await getVenuePricing(venueId);
    const lock = formData.get("locked") === "on";
    if (lock && !ready) return { status: "error", message: "Locking packages against AI changes needs database migration 0027. Save without the lock, or ask an admin to apply it." };
    const id = await saveMenuPackage(venueId, {
      packageId,
      name: String(formData.get("name") ?? ""),
      perHeadInr: amount(formData, "per_head_inr"),
      dietaryTags: formData.getAll("dietary_tags").map(String),
      description: String(formData.get("description") ?? "").trim() || null,
      isActive: formData.get("is_active") === "on",
    });
    const locked = new Set(pricing.lockedPackageIds);
    if (lock) locked.add(id);
    else locked.delete(id);
    if (ready && locked.size !== pricing.lockedPackageIds.length) await saveVenuePricing(venueId, { lockedPackageIds: [...locked] }, userId);
    revalidatePricing();
    return { status: "success", message: packageId ? "Package saved." : "Package added. New quotes can offer it." };
  } catch (err) {
    return failure("save package", err);
  }
}

/** Deposit and cancellation tiers. */
export async function saveTermsAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const { venueId, userId } = await actingVenue(formData);
    if (!venueId) return { status: "error", message: "Choose a venue." };
    const deposit = parseDepositPct(String(formData.get("deposit_pct") ?? ""));
    if (!deposit.ok) return { status: "error", message: deposit.error };
    const cancellation = parseCancellationRows(rows(formData, { days: "cancel_days", pct: "cancel_pct" }));
    if (!cancellation.ok) return { status: "error", message: cancellation.error };
    const { ready } = await getVenuePricing(venueId);
    if (!ready && deposit.value !== null) {
      return { status: "error", message: "A venue deposit needs database migration 0027. Leave it blank to save the cancellation terms, or ask an admin to apply it." };
    }
    if (ready) await saveVenuePricing(venueId, { depositPct: deposit.value }, userId);
    await saveCancellationTerms(venueId, cancellation.value);
    revalidatePricing();
    return { status: "success", message: "Saved. Deposits authorised from now on use this rate; clients see the cancellation terms on your listing." };
  } catch (err) {
    return failure("save terms", err);
  }
}

/** Adds a weekend surcharge, peak season or high-demand date range to the rate calendar. */
export async function addRateMultiplierAction(_prev: HostFormState, formData: FormData): Promise<HostFormState> {
  try {
    const { venueId, userId } = await actingVenue(formData);
    if (!venueId) return { status: "error", message: "Choose a venue." };
    const parsed = parseMultiplierForm(
      {
        kind: String(formData.get("kind") ?? ""),
        label: String(formData.get("label") ?? ""),
        weekdays: formData.getAll("weekdays").map(String),
        startsOn: String(formData.get("starts_on") ?? ""),
        endsOn: String(formData.get("ends_on") ?? ""),
        multiplier: String(formData.get("multiplier") ?? ""),
      },
      crypto.randomUUID()
    );
    if (!parsed.ok) return { status: "error", message: parsed.error };
    const { pricing } = await getVenuePricing(venueId);
    if (pricing.multipliers.length >= PRICING_LIMITS.maxMultipliers) return { status: "error", message: `The calendar holds at most ${PRICING_LIMITS.maxMultipliers} rates. Remove one first.` };
    await saveVenuePricing(venueId, { multipliers: [...pricing.multipliers, parsed.value] }, userId);
    revalidatePricing();
    return { status: "success", message: `Added ${parsed.value.label}. New quotes for those dates use ×${parsed.value.multiplier}.` };
  } catch (err) {
    return failure("add rate", err);
  }
}

export async function removeRateMultiplierAction(formData: FormData) {
  const { venueId, userId } = await actingVenue(formData);
  const id = String(formData.get("multiplier_id") ?? "");
  if (!venueId || !id) throw new Error("Invalid rate action");
  const { pricing } = await getVenuePricing(venueId);
  await saveVenuePricing(venueId, { multipliers: pricing.multipliers.filter((m) => m.id !== id) }, userId);
  revalidatePricing();
}
