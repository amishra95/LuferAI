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
 * Opens a checkout from /api/payments/create-intent (or the concierge's
 * createInvoiceAndPayment tool) in the browser: Stripe redirects, Razorpay
 * opens Checkout.js with the server-built options (UPI first, GST notes).
 */
export async function openCheckout(
  checkout: DepositCheckout,
  { description, onPaid, onDismiss, onFailed }: { description: string; onPaid: () => void; onDismiss: () => void; onFailed: (message: string) => void }
) {
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
    name: "Lufer",
    description,
    config: checkout.config,
    notes: checkout.notes,
    prefill: checkout.prefill,
    // The webhook is the source of truth; callers refresh to pick up its status.
    handler: onPaid,
    modal: { ondismiss: onDismiss },
  });
  rzp.on("payment.failed", (resp) => onFailed(resp.error.description));
  rzp.open();
}
