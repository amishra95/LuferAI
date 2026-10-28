"use server";

import { refresh, revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { MarketplaceError, setLinkedAccount } from "@/lib/marketplace/service";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { recordAudit } from "@/lib/partner/service";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A partner's settlement terms: the Razorpay Route linked account payouts go
 * to, and the platform commission on new orders. Platform admins only: the
 * account is KYC'd with Razorpay and the commission is contractual.
 */
export async function setPayoutTermsAction(partnerId: string, input: { accountId: string; commissionPercent: number }): Promise<ActionResult<{ accountStatus: string | null }>> {
  return serverDispatch("partner/setPayoutTerms", async () => {
    const member = await requirePortal("/partner");
    if (member.role !== "ADMIN") throw new ActionError("Only Lufer admins change payout terms.");
    const pct = Number(input.commissionPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new ActionError("Commission is between 0% and 50%.");
    const rate = Math.round(pct * 100) / 10_000;
    const { error } = await createAdminClient().from("partners").update({ commission_rate: rate }).eq("id", partnerId);
    if (error) throw error;
    let accountStatus: string | null;
    try {
      ({ status: accountStatus } = await setLinkedAccount(partnerId, input.accountId || null));
    } catch (err) {
      if (err instanceof MarketplaceError) throw new ActionError(err.message);
      throw err;
    }
    await recordAudit({ partnerId, actorId: member.userId, action: "partner.payout_terms", entity: "partner", entityId: partnerId, detail: { commission_rate: rate, razorpay_account_id: input.accountId || null } });
    revalidatePath("/partner");
    refresh();
    return { accountStatus };
  });
}
