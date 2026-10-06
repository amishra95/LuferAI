import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { PortalRole } from "@/lib/supabase/database.types";
import { canAccess, homeFor, type Portal } from "./roles";

export interface Member {
  userId: string;
  email: string | null;
  role: PortalRole;
  companyId: string | null;
  venueId: string | null;
  /** CLIENT users on their company's approval_chains (they decide policy breaches). */
  canApprove: boolean;
}

/** The signed-in user's portal membership, or null. Deduped per request. */
export const getCurrentMember = cache(async (): Promise<Member | null> => {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const { data: row } = await supabase
    .from("platform_users")
    .select("role, company_id, venue_id")
    .eq("user_id", claims.sub)
    .maybeSingle();
  if (!row) return null;

  // RLS ("tenant users manage own approval chain") lets a client read their own chain.
  let canApprove = false;
  if (row.role === "CLIENT" && row.company_id) {
    const { data: tier } = await supabase
      .from("approval_chains")
      .select("id")
      .eq("tenant_id", row.company_id)
      .eq("approver_user_id", claims.sub)
      .limit(1)
      .maybeSingle();
    canApprove = Boolean(tier);
  }

  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    role: row.role,
    companyId: row.company_id,
    venueId: row.venue_id,
    canApprove,
  };
});

/**
 * Authoritative portal check for layouts, pages and server actions. middleware.ts
 * does the same check first, but it must not be the only gate (and server actions
 * can be invoked independently of the page that renders them).
 */
export async function requirePortal(portal: Portal): Promise<Member> {
  const member = await getCurrentMember();
  if (!member) redirect(`/login?next=${encodeURIComponent(portal)}`);
  if (!canAccess(member.role, portal)) redirect(homeFor(member.role));
  return member;
}
