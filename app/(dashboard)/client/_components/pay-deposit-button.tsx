"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DepositCheckout } from "@/lib/payments/gateways";
import { openCheckout } from "@/lib/payments/open-checkout";

/**
 * Takes the booking deposit. It's captured when the venue confirms and released if
 * the venue declines — a card hold is simply dropped; UPI and netbanking debit
 * immediately, so those are refunded instead.
 *
 * Razorpay opens with UPI first (dynamic QR on desktop, UPI apps on mobile, or a
 * UPI ID), then cards and netbanking — see RAZORPAY_CHECKOUT_CONFIG.
 */
export function PayDepositButton({
  bookingId,
  orderId,
  invoiceId,
  balanceFor,
  label,
}: { label: string } & (
  | { bookingId: string; orderId?: never; invoiceId?: never; balanceFor?: never }
  | { orderId: string; bookingId?: never; invoiceId?: never; balanceFor?: never }
  /** A contract instalment (deposit or balance invoice), captured on authorisation. */
  | { invoiceId: string; bookingId?: never; orderId?: never; balanceFor?: never }
  /** The balance on a booking's issued tax invoice (booking id), captured on authorisation. */
  | { balanceFor: string; bookingId?: never; orderId?: never; invoiceId?: never }
)) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A catalogue order is paid in full and split to the supplier (Razorpay Route).
        body: JSON.stringify(balanceFor ? { balanceFor } : invoiceId ? { invoiceId } : orderId ? { orderId } : { bookingId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start checkout");
      const checkout = json.checkout as DepositCheckout;

      await openCheckout(checkout, {
        description: balanceFor ? "Invoice balance" : invoiceId ? "Contract instalment" : orderId ? "Order payment · captured when the supplier confirms" : "Event deposit · refunded if the venue declines",
        // Confirmed with the server before this runs (lib/payments/open-checkout.ts).
        onPaid: () => {
          setPending(false);
          router.refresh();
        },
        onDismiss: () => setPending(false),
        onFailed: setError,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setPending(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-1">
      <Button type="button" size="sm" variant="outline" onClick={start} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CreditCard aria-hidden />}
        {label}
      </Button>
      {error ? <p className="text-destructive text-caption">{error}</p> : null}
    </div>
  );
}
