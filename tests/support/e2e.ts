/**
 * Shared plumbing for the Playwright suite (tests/*.spec.ts).
 *
 * Environment (put it in .env.local or the CI job):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   E2E_BUYER_EMAIL     CLIENT user (Organizer or Approver) with open POs
 *   E2E_BUYER2_EMAIL    a second CLIENT user in the same company (multiplayer)
 *   E2E_PARTNER_EMAIL   PARTNER user with orders.fulfil and some orders
 *   E2E_ADMIN_EMAIL     ADMIN user, for switching the workspace agent off (optional)
 *   E2E_EVENT_ID        booking id of an event workspace both buyers can open
 *   E2E_ALLOW_MUTATIONS=1  lets tests write (add a guest and RSVP, toggle the
 *                       agent, move an order). Leave unset against shared data.
 *
 * Accounts sign in with magic-link tokens from the admin API, through the
 * app's own /auth/callback?token_hash=… path, so no inbox is involved.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

export type Role = "buyer" | "buyer2" | "partner" | "admin";

const EMAIL_VAR: Record<Role, string> = {
  buyer: "E2E_BUYER_EMAIL",
  buyer2: "E2E_BUYER2_EMAIL",
  partner: "E2E_PARTNER_EMAIL",
  admin: "E2E_ADMIN_EMAIL",
};

export const HOME: Record<Role, string> = { buyer: "/client", buyer2: "/client", partner: "/partner", admin: "/admin" };

const env = (name: string) => process.env[name]?.trim() ?? "";

export const supabaseUrl = () => env("NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = () => env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

/** True when the suite can mint sessions: Supabase URL, anon key and service role key are set. */
export const authReady = () => Boolean(supabaseUrl() && supabaseAnonKey() && env("SUPABASE_SERVICE_ROLE_KEY"));

export const emailFor = (role: Role) => env(EMAIL_VAR[role]);
export const hasRole = (role: Role) => authReady() && Boolean(emailFor(role));

/** Why a test needing these roles is skipped, or null when it can run. */
export function missing(...roles: Role[]): string | null {
  if (!authReady()) return "Supabase isn't configured (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)";
  const absent = roles.filter((r) => !emailFor(r)).map((r) => EMAIL_VAR[r]);
  return absent.length ? `Set ${absent.join(", ")}` : null;
}

export const authFile = (role: Role) => `playwright/.auth/${role}.json`;

export const eventId = () => env("E2E_EVENT_ID");

export const mutationsAllowed = () => env("E2E_ALLOW_MUTATIONS") === "1";
export const MUTATIONS_OFF = "Writes test data; set E2E_ALLOW_MUTATIONS=1 to run it";

let admin: SupabaseClient | null = null;
/** Service-role client: mints sign-in tokens and cleans up fixtures. Bypasses RLS. */
export function adminClient(): SupabaseClient {
  return (admin ??= createClient(supabaseUrl(), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }));
}

/** A one-time magic-link token hash for `email` (no email is sent). */
export async function magicLinkTokenHash(email: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink failed for ${email}: ${error?.message ?? "no token"}`);
  return data.properties.hashed_token;
}

/** An access token for `role`, for Node-side Realtime clients. */
export async function accessTokenFor(role: Role): Promise<string> {
  const anon = createClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: await magicLinkTokenHash(emailFor(role)), type: "magiclink" });
  if (error || !data.session) throw new Error(`verifyOtp failed for ${role}: ${error?.message ?? "no session"}`);
  return data.session.access_token;
}

/** React dev warnings the feed and board must never produce. */
const REACT_PROBLEMS = [/two children with the same key/i, /hydration/i, /did not match/i, /server rendered (html|text) didn't match/i];

/** Collects console errors and React key/hydration warnings on `page`; read the array after acting. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (REACT_PROBLEMS.some((re) => re.test(text))) problems.push(text);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/** A unique tag for fixture rows, so cleanup only touches what this run made. */
export const runTag = () => `e2e-${Date.now().toString(36)}`;
