// Imports server actions for tests: registers the module hooks
// (server-action-hooks.mjs), forces the in-memory data store and lets a test
// choose who is signed in. Import this before the actions themselves.
import { register } from "node:module";

register("./server-action-hooks.mjs", import.meta.url);

// The mock store (lib/data/mock-store.ts): never Supabase or Redis from a test.
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) delete process.env[k];

/** Signs in as a portal member (lib/auth/session.ts's Member), or signs out with null. */
export function signIn(member) {
  globalThis.__testMember = member && { email: null, venueId: null, partnerId: null, partnerRole: null, corporateRole: null, canApprove: false, ...member };
}
