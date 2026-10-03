import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Service-role client — BYPASSES RLS. Server-only.
 * The portals use this until per-portal sign-in exists; switch reads to
 * lib/supabase/server.ts once users are mapped in public.platform_users.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
