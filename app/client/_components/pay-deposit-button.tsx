"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DepositCheckout } from "@/lib/payments/gateways";

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (resp: { error: { description: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load Razorpay Checkout"));
    document.body.appendChild(script);
  });
}

/**
 * Takes the booking deposit. It's captured when the venue confirms and released if
 * the venue declines — a card hold is simply dropped; UPI and netbanking debit
 * immediately, so those are refunded instead.
 *
 * Razorpay opens with UPI first (dynamic QR on desktop, UPI apps on mobile, or a
 * UPI ID), then cards and netbanking — see RAZORPAY_CHECKOUT_CONFIG.
 */
export function PayDepositButton({ bookingId, label }: { bookingId: string; label: string }) {
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
        body: JSON.stringify({ bookingId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start checkout");
      const checkout = json.checkout as DepositCheckout;

      if (checkout.provider === "stripe") {
        window.location.assign(checkout.url);
        return;
      }

      await loadRazorpay();
      const rzp = new window.Razorpay!({
        key: checkout.keyId,
        order_id: checkout.orderId,
        amount: checkout.amountPaise,
        currency: checkout.currency,
        name: "CorpHospitality",
        description: "Event deposit · refunded if the venue declines",
        // Server-built: UPI-first display config, prefill, and B2B GST notes that
        // Razorpay stores on the payment (and so includes in every webhook).
        config: checkout.config,
        notes: checkout.notes,
        prefill: checkout.prefill,
        // The webhook is the source of truth; refresh to pick up its status.
        handler: () => setTimeout(() => router.refresh(), 1500),
        modal: { ondismiss: () => setPending(false) },
      });
      rzp.on("payment.failed", (resp) => setError(resp.error.description));
      rzp.open();
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
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
