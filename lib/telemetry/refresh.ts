/**
 * Which pages a live telemetry event makes stale. The shell's LiveRefresh
 * (components/workspace/live-refresh.tsx) refreshes the current page's server
 * data when an event touches it, so a change made in one tab, by another
 * user, or by the inspector or ⌘K on another page shows up without a reload.
 *
 * Pure: tests import it directly (tests/mutations.test.mjs).
 */
import type { TelemetryEvent } from "./events.ts";

/** Path prefixes whose server-rendered data depends on each event type. */
export const STALE_PATHS: Record<TelemetryEvent["type"], readonly string[]> = {
  // Spans arrive constantly and change no page until the trace is stored.
  span: [],
  trace: ["/admin/analytics"],
  run: ["/agents", "/admin/analytics", "/dashboard"],
  "agent-config": ["/agents", "/chat"],
  "venue-sync": ["/venues"],
  "venue-updated": ["/venues", "/partner"],
  // Booking data shows on the portals (client, approvals, property) and admin.
  booking: ["/client", "/property", "/admin", "/dashboard"],
  approval: ["/client", "/admin"],
  expense: ["/client", "/admin"],
  po: ["/client", "/admin"],
};

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Whether any of these events makes the page at `pathname` stale. */
export function isStale(pathname: string, events: readonly Pick<TelemetryEvent, "type">[]): boolean {
  return events.some((e) => STALE_PATHS[e.type].some((p) => under(pathname, p)));
}

/** Events newer than `afterSeq` (the buffer is ordered by seq). */
export function eventsAfter<E extends Pick<TelemetryEvent, "seq">>(events: readonly E[], afterSeq: number): E[] {
  let i = events.length;
  while (i > 0 && events[i - 1].seq > afterSeq) i--;
  return events.slice(i);
}
