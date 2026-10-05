import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { clean } from "./env";

/**
 * Per-request Supabase client bound to the signed-in user's session cookies.
 * RLS applies — use this once auth is wired up (see supabase/migrations/*_portal_access_rls.sql).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component — cookies are read-only there; safe to ignore
            // when a proxy refreshes sessions.
          }
        },
      },
    }
  );
}
