/**
 * The venue quote form (app/(vendor)/quote/[token]): what can be included, and
 * validation of what's posted. Pure and free of Node built-ins, so the browser
 * form shares it with the server action, and tests import it directly.
 */
import { roundInr } from "../gst-engine.ts";

/** What a venue can tick as included in the per-head price. */
export const INCLUSIONS = [
  { id: "welcome_drink", label: "Welcome drink" },
  { id: "soft_beverages", label: "Unlimited soft beverages" },
  { id: "live_counter", label: "Live counter" },
  { id: "dessert_station", label: "Dessert station" },
  { id: "av_mic", label: "AV & mic" },
  { id: "projector", label: "Projector & screen" },
  { id: "decor", label: "Basic décor" },
  { id: "private_area", label: "Private area" },
  { id: "valet", label: "Valet parking" },
] as const;
export type InclusionId = (typeof INCLUSIONS)[number]["id"];

const LABEL = new Map<string, string>(INCLUSIONS.map((i) => [i.id, i.label]));
const BY_LABEL = new Map<string, InclusionId>(INCLUSIONS.map((i) => [i.label, i.id]));

/** Highest per-head a link accepts; anything above is a typo (an extra zero). */
export const MAX_PER_HEAD_INR = 100_000;
export const MAX_NOTES = 500;
const INCLUDES = "Includes: ";

/** Inclusions and free text as one rfp_responses.notes value: "Includes: A, B." then the notes. */
export function composeQuoteNotes(inclusions: readonly string[], notes: string): string | null {
  const labels = inclusions.map((i) => LABEL.get(i)).filter(Boolean);
  const text = [labels.length ? `${INCLUDES}${labels.join(", ")}.` : "", notes.trim()].filter(Boolean).join("\n");
  return text || null;
}

/** The reverse of composeQuoteNotes, to pre-fill the form with what the venue sent last time. */
export function splitQuoteNotes(notes: string | null | undefined): { inclusions: InclusionId[]; notes: string } {
  const [first, ...rest] = (notes ?? "").split("\n");
  if (!first.startsWith(INCLUDES) || !first.endsWith(".")) return { inclusions: [], notes: notes ?? "" };
  const labels = first.slice(INCLUDES.length, -1).split(", ");
  const ids = labels.map((l) => BY_LABEL.get(l));
  // Not one of ours (a venue wrote "Includes: …" by hand): keep it as text.
  if (ids.some((id) => !id)) return { inclusions: [], notes: notes ?? "" };
  return { inclusions: ids as InclusionId[], notes: rest.join("\n") };
}

export type QuoteSubmission = { decline: true; notes: string | null } | { decline: false; perHeadInr: number; menuPackageId: string | null; notes: string | null };

/**
 * Validates the posted form. `packageIds` are the venue's active packages: a
 * package from anywhere else is refused here rather than by the database.
 */
export function parseQuoteForm(
  form: { intent?: unknown; perHead?: unknown; packageId?: unknown; inclusions?: unknown[]; notes?: unknown },
  packageIds: readonly string[]
): { ok: true; value: QuoteSubmission } | { ok: false; error: string } {
  const notesText = String(form.notes ?? "").trim();
  if (notesText.length > MAX_NOTES) return { ok: false, error: `Keep notes under ${MAX_NOTES} characters.` };
  const inclusions = [...new Set((form.inclusions ?? []).map(String))];
  if (inclusions.some((i) => !LABEL.has(i))) return { ok: false, error: "Unknown inclusion." };

  if (form.intent === "decline") return { ok: true, value: { decline: true, notes: notesText || null } };
  if (form.intent !== "quote") return { ok: false, error: "Choose to send a quote or decline." };

  const raw = String(form.perHead ?? "").replace(/[₹,\s]/g, "");
  const perHead = Number(raw);
  if (!raw || !Number.isFinite(perHead) || perHead <= 0) return { ok: false, error: "Enter a per-head price." };
  if (perHead > MAX_PER_HEAD_INR) return { ok: false, error: `That's over ₹${MAX_PER_HEAD_INR.toLocaleString("en-IN")} a head. Check the price.` };
  // To the paisa, as invoices round (lib/gst-engine).
  const perHeadInr = roundInr(perHead);

  const packageId = String(form.packageId ?? "");
  if (packageId && !packageIds.includes(packageId)) return { ok: false, error: "That menu package isn't available." };

  return { ok: true, value: { decline: false, perHeadInr, menuPackageId: packageId || null, notes: composeQuoteNotes(inclusions, notesText) } };
}
