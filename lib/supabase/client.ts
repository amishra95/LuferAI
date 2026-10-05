import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { clean } from "./env";

/** Browser-side Supabase client (anon key, RLS enforced). Use inside Client Components. */
export function createClient() {
  return createBrowserClient<Database>(
    clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}
