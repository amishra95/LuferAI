// Imports server code for tests: registers the module hooks
// (server-action-hooks.mjs), forces the in-memory data store and lets a test
// choose who is signed in and how workflows start. Import this before the code under test.
import { register } from "node:module";

register("./server-action-hooks.mjs", import.meta.url);

// The mock store (lib/data/mock-store.ts): never Supabase or Redis from a test, and no vault unless a test sets one.
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "OAUTH_VAULT_KEY"]) delete process.env[k];

/** Signs in as a portal member (lib/auth/session.ts's Member), or signs out with null. */
export function signIn(member) {
  globalThis.__testMember = member && { email: null, venueId: null, partnerId: null, partnerRole: null, corporateRole: null, canApprove: false, ...member };
}

/** What workflow/api's start() does: `impl(workflow, args)` → a Run, or null for "runtime unavailable". */
export function onWorkflowStart(impl) {
  globalThis.__workflowStart = impl ?? undefined;
}
