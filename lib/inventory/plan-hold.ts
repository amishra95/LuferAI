/**
 * Pure hold timing (tested in tests/rates-and-holds.test.mjs).
 *
 * Holds last 24h when the booking goes straight to the venue, 48h when it first
 * needs the client's internal sign-off, so the manager has time to decide.
 */

export const HOLD_HOURS = { direct: 24, awaitingApproval: 48 } as const;

export function planHold(needsApproval: boolean, now: Date = new Date()) {
  const hours = needsApproval ? HOLD_HOURS.awaitingApproval : HOLD_HOURS.direct;
  return {
    hours,
    hold_start: now.toISOString(),
    hold_expires_at: new Date(now.getTime() + hours * 3_600_000).toISOString(),
  };
}

/** "5h 12m left", "45m left" or "Expired". Rounds down so it never overstates time left. */
export function formatHoldCountdown(expiresAt: string, now: number): string {
  const minutes = Math.floor((new Date(expiresAt).getTime() - now) / 60_000);
  if (minutes <= 0) return "Expired";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
