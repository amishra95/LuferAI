import { isAccountType, isApplicationStatus, landingFor, WELCOME_PATH } from "@/lib/auth/onboarding";
import { canAccess, homeFor, portalFor, safeNextPath } from "@/lib/auth/roles";
import { parseSignupInput } from "@/lib/auth/signup-input";
import { ssoProviderOf } from "@/lib/auth/sso";
import { provisionSsoUser } from "@/lib/auth/sso-store";
import { activateSignupApplication, createSignupApplication, getSignupApplication } from "@/lib/data";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Where a user goes right after any sign-in (email link, Google, SSO or
 * password). Members go to their portal, or to `next` when their role may open
 * it. A first sign-in through a company's SSO provider joins that company
 * (lib/auth/sso.ts). Someone without a portal role lands per applicantLanding.
 */
export async function landingAfterSignIn(supabase: ServerClient, nextParam: string | null): Promise<string> {
  const next = safeNextPath(nextParam);
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub ?? "";
  let { data: member } = await supabase.from("platform_users").select("role").eq("user_id", userId).maybeSingle();
  if (!member && ssoProviderOf(claims?.claims.app_metadata)) {
    const { data } = await supabase.auth.getUser();
    if (data.user && (await provisionSsoUser(data.user)).provision) {
      // Memberships ride in the token (custom_access_token_hook): reissue it so the portals let them in.
      await supabase.auth.refreshSession();
      member = { role: "CLIENT" };
    }
  }
  if (!member) {
    const landing = await applicantLanding(supabase, userId);
    // Someone with no portal yet may still set a password.
    return next === "/password" && userId ? next : landing;
  }

  // Honour ?next only if this role may open it; otherwise go to the role's own portal.
  const nextPortal = next ? portalFor(next.split("?")[0]) : null;
  return next && (!nextPortal || canAccess(member.role, nextPortal)) ? next : homeFor(member.role);
}

/**
 * Where someone without a portal role lands. With an application (recorded
 * first if they've just verified a signup) that can be activated: it is, and
 * they go to their welcome page. One an admin must decide: the waiting room.
 * Otherwise "no access". Never throws: a failure here only costs them the
 * waiting room (they can sign in again).
 */
async function applicantLanding(supabase: ServerClient, userId: string): Promise<string> {
  if (!userId) return landingFor(null, null);
  try {
    let application = await getSignupApplication(userId);
    if (!application) {
      const { data } = await supabase.auth.getUser();
      const signup = data.user?.user_metadata?.signup;
      // The verified address, not whatever the form carried.
      const parsed = signup && data.user?.email ? parseSignupInput({ ...signup, email: data.user.email }) : null;
      if (parsed?.ok) application = await createSignupApplication(userId, parsed.value);
    }
    if (application?.status === "pending_approval") {
      application = await activateSignupApplication(application.id);
      if (application.status === "active" && isAccountType(application.account_type)) {
        // Memberships ride in the token (custom_access_token_hook): reissue it so the portal lets them in.
        await supabase.auth.refreshSession();
        return WELCOME_PATH[application.account_type];
      }
    }
    return landingFor(null, isApplicationStatus(application?.status) ? application.status : null);
  } catch (err) {
    console.error("auth: could not record the signup application", err);
    return landingFor(null, null);
  }
}
