"use client";

import { useActionState, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn, formatINR } from "@/lib/utils";
import { INCLUSIONS, MAX_NOTES, type InclusionId } from "@/lib/vendor/quote-form";
import type { VendorQuoteView } from "@/lib/vendor/quote-service";
import { submitQuoteAction, type QuoteFormState } from "../actions";

const chip =
  "border-line-strong hover:bg-surface-hover flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-body has-checked:bg-surface-raised has-checked:border-fg-subtle has-focus-visible:ring-2 has-focus-visible:ring-ring";

/**
 * Price, package, inclusions and a note, then send (or decline). Pre-filled
 * with the venue's current answer, so confirming the standard price is one tap.
 * Works before hydration (a plain form post).
 */
export function QuoteForm({
  token,
  partySize,
  packages,
  current,
}: {
  token: string;
  partySize: number;
  packages: VendorQuoteView["packages"];
  current: VendorQuoteView["current"];
}) {
  const [state, action, pending] = useActionState<QuoteFormState, FormData>(submitQuoteAction.bind(null, token), null);
  const [perHead, setPerHead] = useState(current.perHeadInr != null ? String(current.perHeadInr) : "");
  const [packageId, setPackageId] = useState(current.menuPackageId ?? "");
  const total = Number(perHead.replace(/[₹,\s]/g, "")) * partySize;

  return (
    <form action={action} className="panel grid gap-5 p-5">
      <div className="grid gap-1.5">
        <Label htmlFor="perHead">Your price per head</Label>
        <div className="border-line-strong focus-within:ring-ring flex items-center rounded-md border px-3 focus-within:ring-2">
          <span className="text-fg-subtle text-section" aria-hidden>
            ₹
          </span>
          <input
            id="perHead"
            name="perHead"
            inputMode="decimal"
            autoComplete="off"
            required
            value={perHead}
            onChange={(e) => setPerHead(e.target.value)}
            className="text-section min-h-14 w-full bg-transparent px-2 font-medium tabular-nums outline-none"
            aria-describedby="perHead-total"
          />
        </div>
        <p id="perHead-total" className="text-fg-subtle text-caption tabular-nums" aria-live="polite">
          {total > 0 ? `${formatINR(total)} for ${partySize} guests, before GST` : `For ${partySize} guests, before GST`}
        </p>
      </div>

      {packages.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-body font-medium">Menu package</legend>
          {[{ id: "", name: "No set package", perHeadInr: null as number | null, description: null as string | null }, ...packages].map((p) => (
            <label key={p.id || "none"} className={cn(chip, "justify-between py-2")}>
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="packageId"
                  value={p.id}
                  checked={packageId === p.id}
                  onChange={() => {
                    setPackageId(p.id);
                    // Picking a package starts from its price; the venue can still change it.
                    if (p.perHeadInr != null) setPerHead(String(p.perHeadInr));
                  }}
                  className="accent-current"
                />
                <span>
                  {p.name}
                  {p.description ? <span className="text-fg-subtle block text-caption">{p.description}</span> : null}
                </span>
              </span>
              {p.perHeadInr != null ? <span className="text-fg-muted text-meta tabular-nums">{formatINR(p.perHeadInr)}</span> : null}
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-body font-medium">Included in the price</legend>
        <div className="flex flex-wrap gap-2">
          {INCLUSIONS.map((i) => (
            <label key={i.id} className={chip}>
              <input type="checkbox" name="inclusions" value={i.id} defaultChecked={current.inclusions.includes(i.id as InclusionId)} className="sr-only" />
              <Check className="hidden size-4 [label:has(:checked)>&]:block" aria-hidden />
              {i.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="notes">Note for the client (optional)</Label>
        <textarea id="notes" name="notes" rows={2} maxLength={MAX_NOTES} defaultValue={current.notes} placeholder="Minimum spend, timings, what's extra…" className="field h-auto py-2" />
      </div>

      {state && !state.ok ? (
        <p role="alert" className="text-rose text-body">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sage flex items-center gap-1.5 text-body">
          <Check className="size-4" aria-hidden /> {state.declined ? "Declined. You can still send a price from this link while the RFP is open." : "Sent. The client sees your quote now."}
        </p>
      ) : null}

      <div className="bg-surface border-line fixed inset-x-0 bottom-0 z-10 border-t px-4 pt-3 pb-[calc(0.75rem+var(--app-safe-bottom))]">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Button type="submit" name="intent" value="decline" variant="ghost" formNoValidate disabled={pending} className="min-h-12">
            Decline
          </Button>
          <Button type="submit" name="intent" value="quote" disabled={pending} className="min-h-12 flex-1">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {current.status === "quoted" ? "Send quote" : "Update quote"}
          </Button>
        </div>
      </div>
    </form>
  );
}
