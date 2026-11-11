"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { withdrawRequestAction } from "@/app/(dashboard)/client/actions";
import { useAction } from "@/components/workspace/use-optimistic-mutation";

/** Withdraw on an open concierge request (Home → Requests): asks once, then closes it. */
export function WithdrawRequest({ requestId }: { requestId: string }) {
  const [confirming, setConfirming] = useState(false);
  const act = useAction<{ ok: true }>();
  const router = useRouter();

  const withdraw = async () => {
    const outcome = await act.run(() => withdrawRequestAction(requestId), {
      failure: "Couldn't withdraw the request",
      success: () => ({ tone: "success", title: "Request withdrawn", description: "Lufer has been told to stop working on it." }),
    });
    if (outcome?.ok) router.refresh();
  };

  if (!confirming) {
    return (
      <button type="button" className="btn btn-ghost h-7 px-2 text-caption" onClick={() => setConfirming(true)}>
        Withdraw
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button type="button" className="btn btn-ghost h-7 px-2 text-caption" onClick={() => setConfirming(false)} disabled={act.pending}>
        Keep
      </button>
      <button type="button" className="btn h-7 border-rose px-2 text-caption text-rose" onClick={() => void withdraw()} disabled={act.pending}>
        {act.pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        Withdraw request
      </button>
    </span>
  );
}
