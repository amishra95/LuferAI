/**
 * How quickly a venue answers, shown to the venue itself: companies already
 * see "Usually confirms within N h" on its card (lib/venues/signals.ts), and a
 * request left past its hold may go elsewhere. Pure: tests import it.
 */

export const HOLD_HOURS = 24;

/** Whether a request has waited past the hold Lufer gave the venue. */
export function holdLapsed(createdAt: string, now = Date.now(), hours = HOLD_HOURS): boolean {
  return now - Date.parse(createdAt) > hours * 3_600_000;
}

/** "Under 1 h", "6 h", "2 d", or "—" before there's a reply to measure. */
export function replyTimeLabel(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  if (hours < 1) return "Under 1 h";
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}
