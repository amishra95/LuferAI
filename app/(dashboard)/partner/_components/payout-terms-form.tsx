"use client";

import { Loader2 } from "lucide-react";

import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { setPayoutTermsAction } from "../payout-actions";

/** Admin-only: the partner's Route linked account and commission. */
export function PayoutTermsForm({ partnerId, accountId, commissionRate }: { partnerId: string; accountId: string | null; commissionRate: number }) {
  const save = useAction<{ accountStatus: string | null }>();
  return (
    <form
      key={`${accountId}-${commissionRate}`}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void save.run(() => setPayoutTermsAction(partnerId, { accountId: String(f.get("accountId") ?? "").trim(), commissionPercent: Number(f.get("commission")) }), {
          failure: "Couldn't save payout terms",
          success: (r) => ({ tone: "success", title: "Payout terms saved", description: r.accountStatus ? `Linked account is ${r.accountStatus}. Paid orders are being settled.` : "No linked account: payouts wait until one is connected." }),
        });
      }}
      className="grid gap-2.5 text-caption sm:grid-cols-[1fr_8rem_auto] sm:items-end"
    >
      <label className="grid gap-1">
        <span className="text-fg-subtle">Razorpay Route linked account</span>
        <input name="accountId" defaultValue={accountId ?? ""} placeholder="acc_XXXXXXXXXXXXXX" pattern="acc_[A-Za-z0-9]{14}" className="field h-8 font-mono" />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-subtle">Commission %</span>
        <input name="commission" type="number" min={0} max={50} step="0.01" required defaultValue={Math.round(commissionRate * 10_000) / 100} className="field h-8 font-mono" />
      </label>
      <button type="submit" disabled={save.pending} className="btn btn-primary h-8 px-3">
        {save.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null} Save
      </button>
    </form>
  );
}
