"use client";

import { useState, useTransition } from "react";
import { Dialog } from "radix-ui";
import { Loader2, X } from "lucide-react";

import { getManualBookingContext, type ManualBookingContext } from "@/app/(dashboard)/client/actions";
import { EventRequestForm } from "@/app/(dashboard)/client/_components/event-request-form";
import { cn } from "@/lib/utils";

/*
 * Book a venue by hand, no AI: the booking request wizard (venue, date and
 * guests with live availability and the negotiated rate; then requirements and
 * billing; then a GST review) plus event details, in a modal. It submits through
 * submitBookingRequest → placeBookingRequest like every other entry point, so the
 * booking lands in Supabase as "Awaiting sign-off" or "With the venue" per policy.
 *
 * The modal loads its data (company, venues, departments) when opened, so it
 * works anywhere: the client portal, the venue inspector, the venues table.
 */

// React events bubble through portals: keep clicks in the modal from reaching a
// clickable parent (a venue table row opens the inspector on click).
const stop = (e: React.MouseEvent) => e.stopPropagation();

type Load = { status: "loading" } | { status: "ready"; context: ManualBookingContext } | { status: "error"; message: string };

// The default button is already coral (ink text: white on coral fails contrast); make it the brand pill.
const SUBMIT = "h-auto rounded-full px-6 py-3 text-body font-medium has-[>svg]:px-6";

export function ManualBookingModal({
  venueId,
  venueName,
  trigger,
}: {
  /** Pre-selects this venue (from the inspector or a table row). */
  venueId?: string;
  venueName?: string;
  /** The button that opens the modal (rendered as Dialog.Trigger asChild). */
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [, startLoading] = useTransition();
  // Bumped per open so the form starts fresh each time.
  const [session, setSession] = useState(0);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setSession((n) => n + 1);
    if (load.status === "ready") return;
    setLoad({ status: "loading" });
    startLoading(async () => {
      try {
        const result = await getManualBookingContext();
        setLoad("error" in result ? { status: "error", message: result.error } : { status: "ready", context: result });
      } catch {
        setLoad({ status: "error", message: "Couldn't load the booking form. Try again." });
      }
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay onClick={stop} className="bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50" />
        <Dialog.Content
          // The inspector's Escape handler steps aside for modal dialogs.
          aria-modal="true"
          onClick={stop}
          className={cn(
            "lufer bg-canvas border-line fixed z-50 flex flex-col border shadow-2xl outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 duration-200",
            // Phones: a full-width sheet from the bottom. Larger: a centred dialog.
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl pb-[var(--app-safe-bottom)]",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[88dvh] sm:w-[min(44rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0"
          )}
        >
          <header className="border-line flex shrink-0 items-start gap-3 border-b px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-fg text-section font-semibold tracking-tight">Book manually{venueName ? ` · ${venueName}` : ""}</Dialog.Title>
              <Dialog.Description className="text-fg-subtle mt-1 text-meta">
                A direct request to the venue, checked against your company&apos;s policy. Over-policy requests go to your approvers first.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn btn-ghost btn-icon -mr-1.5 size-8" aria-label="Close">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {load.status === "loading" ? (
              <p className="text-fg-subtle flex items-center gap-2 py-8 text-meta" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading venues…
              </p>
            ) : load.status === "error" ? (
              <p className="text-rose py-8 text-meta" role="alert">
                {load.message}
              </p>
            ) : (
              <EventRequestForm
                key={session}
                companyId={load.context.companyId}
                companyGstin={load.context.companyGstin}
                venues={load.context.venues}
                departments={load.context.departments}
                defaultVenueId={venueId && load.context.venues.some((v) => v.id === venueId) ? venueId : ""}
                withEventDetails
                submitLabel="Submit direct RFP"
                submitClassName={SUBMIT}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
