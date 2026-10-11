/**
 * The event plan (event_plans, migration 0026): run of show, catering package
 * and special requirements, with a sign-off flow. Every content change bumps
 * the revision; a client Approver approves a revision, and the venue
 * acknowledges an approved revision. Editing after approval needs a fresh
 * sign-off. Guest check-in opens on the event day.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/event-plan.test.mjs).
 */

export interface RunOfShowItem {
  /** HH:MM, IST. */
  time: string;
  item: string;
}

export interface EventPlan {
  runOfShow: RunOfShowItem[];
  cateringPackageId: string | null;
  specialRequirements: string;
  revision: number;
  approvedRevision: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  venueAckRevision: number | null;
  venueAckAt: string | null;
}

export const EMPTY_PLAN: EventPlan = {
  runOfShow: [],
  cateringPackageId: null,
  specialRequirements: "",
  revision: 0,
  approvedRevision: null,
  approvedBy: null,
  approvedAt: null,
  venueAckRevision: null,
  venueAckAt: null,
};

export const MAX_RUN_OF_SHOW = 30;
export const MAX_ITEM_LENGTH = 120;
export const MAX_REQUIREMENTS = 1000;

export type PlanContent = Pick<EventPlan, "runOfShow" | "cateringPackageId" | "specialRequirements">;
export type PlanResult = { ok: true; value: PlanContent } | { ok: false; error: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validates and normalises the plan form: blank rows dropped, items sorted by time. */
export function validatePlan(input: { runOfShow?: unknown; cateringPackageId?: unknown; specialRequirements?: unknown }): PlanResult {
  const rows = Array.isArray(input.runOfShow) ? input.runOfShow : [];
  const items: RunOfShowItem[] = [];
  for (const [i, raw] of rows.entries()) {
    const r = (raw ?? {}) as { time?: unknown; item?: unknown };
    const time = typeof r.time === "string" ? r.time.trim() : "";
    const item = typeof r.item === "string" ? r.item.trim().replace(/\s+/g, " ") : "";
    if (!time && !item) continue;
    if (!HHMM.test(time)) return { ok: false, error: `Row ${i + 1}: enter a time as HH:MM.` };
    if (!item) return { ok: false, error: `Row ${i + 1}: say what happens at ${time}.` };
    if (item.length > MAX_ITEM_LENGTH) return { ok: false, error: `Row ${i + 1}: keep it under ${MAX_ITEM_LENGTH} characters.` };
    items.push({ time, item });
  }
  if (items.length > MAX_RUN_OF_SHOW) return { ok: false, error: `A run of show can have up to ${MAX_RUN_OF_SHOW} items.` };
  items.sort((a, b) => a.time.localeCompare(b.time));

  const pkg = typeof input.cateringPackageId === "string" && input.cateringPackageId.trim() ? input.cateringPackageId.trim() : null;
  const req = typeof input.specialRequirements === "string" ? input.specialRequirements.replace(/\r\n/g, "\n").trim() : "";
  if (req.length > MAX_REQUIREMENTS) return { ok: false, error: `Special requirements can be at most ${MAX_REQUIREMENTS} characters.` };
  return { ok: true, value: { runOfShow: items, cateringPackageId: pkg, specialRequirements: req } };
}

/** Whether saving `next` changes what the Approver signed off (and so bumps the revision). */
export function planDiffers(current: PlanContent, next: PlanContent): boolean {
  return (
    current.cateringPackageId !== next.cateringPackageId ||
    current.specialRequirements !== next.specialRequirements ||
    JSON.stringify(current.runOfShow) !== JSON.stringify(next.runOfShow)
  );
}

export const isEmptyPlan = (p: PlanContent) => p.runOfShow.length === 0 && !p.cateringPackageId && !p.specialRequirements;

export type PlanStage = "empty" | "draft" | "approved" | "changed";

export interface PlanStatus {
  stage: PlanStage;
  /** The venue acknowledged the approved revision currently in force. */
  venueAcknowledged: boolean;
  label: string;
}

/** Where the plan is in sign-off. "changed" = edited after an approval; it needs a fresh one. */
export function planStatus(plan: EventPlan): PlanStatus {
  if (isEmptyPlan(plan) && plan.approvedRevision === null) return { stage: "empty", venueAcknowledged: false, label: "Not started" };
  if (plan.approvedRevision === null) return { stage: "draft", venueAcknowledged: false, label: "Awaiting sign-off" };
  if (plan.approvedRevision !== plan.revision) return { stage: "changed", venueAcknowledged: false, label: "Changed since sign-off" };
  const acked = plan.venueAckRevision === plan.approvedRevision;
  return { stage: "approved", venueAcknowledged: acked, label: acked ? "Signed off · venue confirmed" : "Signed off · with the venue" };
}

/** Why `role` can't sign off the plan now, or null when it can. Approvers sign off; Organizers prepare. */
export function signOffBlocker(role: string | null, plan: EventPlan): string | null {
  const { stage } = planStatus(plan);
  if (role !== "APPROVER") return role === "ORGANIZER" ? "Only an Approver can sign off the event plan." : "You have read-only access to this event.";
  if (stage === "empty") return "Add a run of show, catering or requirements before signing off.";
  if (stage === "approved") return "Already signed off.";
  return null;
}

/** Why the venue can't acknowledge, or null. */
export function venueAckBlocker(plan: EventPlan): string | null {
  const { stage, venueAcknowledged } = planStatus(plan);
  if (stage !== "approved") return "The client hasn't signed off the current plan yet.";
  if (venueAcknowledged) return "Already confirmed.";
  return null;
}

/** Check-in opens on the event date (IST) for bookings that went ahead. */
export function checkInBlocker(bookingStatus: string, eventDate: string, today: string): string | null {
  if (!["CONFIRMED", "COMPLETED", "SETTLED"].includes(bookingStatus)) return "Check-in opens once the venue confirms the booking.";
  if (eventDate > today) return `Check-in opens on the event day.`;
  return null;
}
