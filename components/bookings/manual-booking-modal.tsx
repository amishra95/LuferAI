"use client";

import { useState, useTransition } from "react";
import { Dialog } from "radix-ui";
import { Loader2, Sparkles, X } from "lucide-react";

import { getManualBookingContext, type ManualBookingContext } from "@/app/(dashboard)/client/actions";
import { EventRequestForm } from "@/app/(dashboard)/client/_components/event-request-form";
import { Button } from "@/components/ui/button";
import { ChatDrawerTrigger } from "@/components/ui/chat-drawer";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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
 * Admins also pick the company and the employee they're filing for; finance
 * viewers get an explanation (their role is read-only) and the concierge.
 */

// React events bubble through portals: keep clicks in the modal from reaching a
// clickable parent (a venue table row opens the inspector on click).
const stop = (e: React.MouseEvent) => e.stopPropagation();

type Load =
  | { status: "loading" }
  | { status: "ready"; context: ManualBookingContext }
  | { status: "readOnly"; message: string }
  | { status: "error"; message: string };

// The default button is already coral (ink text: white on coral fails contrast); make it the brand pill.
const SUBMIT = "h-auto rounded-full px-6 py-3 text-body font-medium has-[>svg]:px-6";

export function ManualBookingModal({
  venueId,
  venueName,
  companyId,
  trigger,
}: {
  /** Pre-selects this venue (from the inspector or a table row). */
  venueId?: string;
  venueName?: string;
  /** Admins: the company to start with (e.g. the one the client portal shows). */
  companyId?: string;
  /** The button that opens the modal (rendered as Dialog.Trigger asChild). */
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [, startLoading] = useTransition();
  // Bumped per open so the form starts fresh each time.
  const [session, setSession] = useState(0);
  // Admins: who the request is filed for.
  const [requesterId, setRequesterId] = useState("");

  function fetchContext(forCompany?: string) {
    setLoad({ status: "loading" });
    startLoading(async () => {
      try {
        const result = await getManualBookingContext(forCompany);
        if ("readOnly" in result) return setLoad({ status: "readOnly", message: result.readOnly });
        if ("error" in result) return setLoad({ status: "error", message: result.error });
        setRequesterId(result.onBehalf?.requesters[0]?.id ?? "");
        setLoad({ status: "ready", context: result });
      } catch {
        setLoad({ status: "error", message: "Couldn't load the booking form. Try again." });
      }
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setSession((n) => n + 1);
    if (load.status !== "ready" && load.status !== "readOnly") fetchContext(companyId);
  }

  const onBehalf = load.status === "ready" ? load.context.onBehalf : undefined;

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
            ) : load.status === "readOnly" ? (
              <div className="grid justify-items-start gap-4 py-4">
                <p className="text-fg-muted text-body">{load.message}</p>
                <Button asChild variant="outline" className="rounded-full">
                  <ChatDrawerTrigger onClick={() => setOpen(false)}>
                    <Sparkles className="text-coral" aria-hidden /> Ask the concierge
                  </ChatDrawerTrigger>
                </Button>
              </div>
            ) : (
              <div className="grid gap-6">
                {onBehalf ? (
                  <fieldset className="bg-surface-raised grid gap-4 rounded-lg p-4 sm:grid-cols-2">
                    <legend className="sr-only">Filing as a platform admin</legend>
                    <div className="grid content-start gap-2">
                      <Label htmlFor="mb-company">Company</Label>
                      <NativeSelect id="mb-company" value={load.context.companyId} onChange={(e) => fetchContext(e.target.value)}>
                        {onBehalf.companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="grid content-start gap-2">
                      <Label htmlFor="mb-requester">File on behalf of</Label>
                      {onBehalf.requesters.length ? (
                        <NativeSelect id="mb-requester" value={requesterId} onChange={(e) => setRequesterId(e.target.value)}>
                          {onBehalf.requesters.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} · {u.role}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <p className="text-rose text-meta">No Organizer or Approver at this company to file for.</p>
                      )}
                    </div>
                    <p className="text-fg-subtle text-caption sm:col-span-2">
                      Policy and approvals run as this person; the venue sees that a Lufer.ai admin filed it.
                    </p>
                  </fieldset>
                ) : null}

                {onBehalf && !onBehalf.requesters.length ? null : (
                  <EventRequestForm
                    key={`${session}-${load.context.companyId}`}
                    extraFields={onBehalf ? { on_behalf_of: requesterId } : undefined}
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
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
