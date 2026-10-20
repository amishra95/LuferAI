import "server-only";

import { createSign } from "node:crypto";

/**
 * Google Calendar free/busy through a service account. For a Workspace domain,
 * grant the account domain-wide delegation for calendar.freebusy and set
 * GOOGLE_CALENDAR_SUBJECT to a user to act as; otherwise share each calendar
 * with the service account's email.
 *
 * Env: GOOGLE_CALENDAR_CLIENT_EMAIL, GOOGLE_CALENDAR_PRIVATE_KEY (PEM; \n escapes ok),
 * optional GOOGLE_CALENDAR_SUBJECT.
 */
const SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const env = (key: string) => (process.env[key] ?? "").trim();

export const isGoogleCalendarConfigured = () => Boolean(env("GOOGLE_CALENDAR_CLIENT_EMAIL") && env("GOOGLE_CALENDAR_PRIVATE_KEY"));

export interface BusyInterval {
  start: string;
  end: string;
}

/** Per calendar (email): busy intervals, or why the calendar couldn't be read. */
export type FreeBusy = Record<string, { busy: BusyInterval[] } | { error: string }>;

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

const g = globalThis as typeof globalThis & { __luferCalendarToken?: { token: string; expiresAt: number } };

/** OAuth access token from a signed service-account JWT, cached until a minute before expiry. */
async function accessToken(): Promise<string> {
  const cached = g.__luferCalendarToken;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env("GOOGLE_CALENDAR_CLIENT_EMAIL"),
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    ...(env("GOOGLE_CALENDAR_SUBJECT") && { sub: env("GOOGLE_CALENDAR_SUBJECT") }),
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(env("GOOGLE_CALENDAR_PRIVATE_KEY").replace(/\\n/g, "\n"));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !json?.access_token) throw new Error(`Google auth failed (${res.status}): ${json?.error_description ?? res.statusText}`);
  g.__luferCalendarToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

/** Busy intervals for each calendar between timeMin and timeMax (ISO 8601). */
export async function googleFreeBusy(calendars: string[], timeMin: string, timeMax: string): Promise<FreeBusy> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, timeZone: "Asia/Kolkata", items: calendars.map((id) => ({ id })) }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as {
    calendars?: Record<string, { busy?: BusyInterval[]; errors?: { reason?: string }[] }>;
    error?: { message?: string };
  } | null;
  if (!res.ok) throw new Error(`Google Calendar freeBusy failed (${res.status}): ${json?.error?.message ?? res.statusText}`);

  return Object.fromEntries(
    calendars.map((id) => {
      const cal = json?.calendars?.[id];
      if (!cal) return [id, { error: "not returned" }];
      // notFound / forbidden: not shared with the service account, or no such calendar.
      if (cal.errors?.length) return [id, { error: cal.errors.map((e) => e.reason ?? "error").join(", ") }];
      return [id, { busy: cal.busy ?? [] }];
    })
  );
}
