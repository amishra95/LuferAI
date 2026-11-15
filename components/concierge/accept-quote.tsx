"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { acceptQuoteAction } from "@/app/(dashboard)/client/actions";
import { useAction } from "@/components/workspace/use-optimistic-mutation";

/** Accept on a quoted concierge request (Home → Requests): asks once, naming the total, then books it. */
export function AcceptQuote({ requestId, totalInr }: { requestId: string; totalInr: number }) {
  const [confirming, setConfirming] = useState(false);
  const act = useAction<{ ok: true }>();
  const router = useRouter();
  const total = `₹${totalInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const accept = async () => {
    const outcome = await act.run(() => acceptQuoteAction({ requestId, totalInr }), {
      failure: "Couldn't accept the quote",
      success: () => ({ tone: "success", title: "Quote accepted", description: "Lufer is confirming with the venue. You can pay from here." }),
    });
    setConfirming(false);
    if (outcome?.ok) router.refresh();
  };

  if (!confirming) {
    return (
      <button type="button" className="btn h-7 px-2 text-caption" onClick={() => setConfirming(true)}>
        Accept quote
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button type="button" className="btn btn-ghost h-7 px-2 text-caption" onClick={() => setConfirming(false)} disabled={act.pending}>
        Not yet
      </button>
      <button type="button" className="btn h-7 px-2 text-caption" onClick={() => void accept()} disabled={act.pending}>
        {act.pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        Accept {total}
      </button>
    </span>
  );
}
