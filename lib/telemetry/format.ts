/**
 * Formatting shared by the analytics charts (client) and pages (server). Kept
 * out of the "use client" chart module: a server component can't call a
 * function exported from one.
 */

const HOUR_MS = 3_600_000;
const hourFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** "840 ms", "2.31 s", or "—" for no reading. */
export const formatMs = (ms: number | null) => (ms === null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

/** Bucket label in IST: "14:00" for hourly buckets, "8 Oct" for daily ones. */
export const bucketLabel = (start: string, bucketMs: number) => (bucketMs <= HOUR_MS ? hourFmt : dayFmt).format(new Date(start));
