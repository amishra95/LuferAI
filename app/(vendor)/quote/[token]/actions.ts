"use server";

import { revalidatePath } from "next/cache";

import { parseQuoteForm } from "@/lib/vendor/quote-form";
import { loadVendorQuote, submitVendorQuote } from "@/lib/vendor/quote-service";

export type QuoteFormState = { ok: true; declined: boolean } | { ok: false; error: string } | null;

const LINK_ERROR = {
  invalid: "This link isn't valid.",
  expired: "This link has expired. Ask the client for a new one.",
  unavailable: "Quotes can't be sent right now. Please try again later.",
} as const;

/**
 * A venue manager's quote from their link. No account: the signed token is the
 * credential, and it only ever answers this one venue's response to this one
 * RFP. The client's comparison and the property portal pick it up on refresh.
 */
export async function submitQuoteAction(token: string, _prev: QuoteFormState, form: FormData): Promise<QuoteFormState> {
  const loaded = await loadVendorQuote(String(token)).catch((err) => {
    console.error("vendor: could not load quote link", err);
    return { status: "unavailable" } as const;
  });
  if (loaded.status !== "open") return { ok: false, error: loaded.status === "closed" ? "This RFP is closed." : LINK_ERROR[loaded.status] };

  const parsed = parseQuoteForm(
    { intent: form.get("intent"), perHead: form.get("perHead"), packageId: form.get("packageId"), inclusions: form.getAll("inclusions"), notes: form.get("notes") },
    loaded.view.packages.map((p) => p.id)
  );
  if (!parsed.ok) return parsed;

  const sent = await submitVendorQuote(String(token), parsed.value);
  if (!sent.ok) return sent;
  revalidatePath(`/quote/${token}`);
  revalidatePath("/property");
  revalidatePath("/client");
  return { ok: true, declined: parsed.value.decline };
}
