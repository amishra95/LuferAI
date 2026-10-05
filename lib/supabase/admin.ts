import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { clean } from "./env";

/**
 * Service-role client — BYPASSES RLS. Server-only.
 * The portals use this until per-portal sign-in exists; switch reads to
 * lib/supabase/server.ts once users are mapped in public.platform_users.
 * Callers must authorise first (requirePortal in lib/auth/session.ts) and scope by
 * the member's company/venue.
 */
export function createAdminClient() {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let warnedInvalidUrl = false;

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True only when both vars are set AND the URL is a real http(s) URL.
 * A malformed URL (e.g. a key pasted into the URL slot) would otherwise make
 * supabase-js throw on every portal request; fall back to mock data instead
 * (the header badge shows "Mock data") and log once so it gets fixed.
 */
export function isSupabaseConfigured(): boolean {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return false;
  if (!isHttpUrl(url)) {
    if (!warnedInvalidUrl) {
      warnedInvalidUrl = true;
      console.error(
        "NEXT_PUBLIC_SUPABASE_URL is not a valid http(s) URL — falling back to mock data. " +
          "Set it to your project URL, e.g. https://<ref>.supabase.co"
      );
    }
    return false;
  }
  return true;
}
