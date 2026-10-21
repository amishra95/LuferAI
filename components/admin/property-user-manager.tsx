"use client";

import { useActionState } from "react";
import { Loader2, Power, UserPlus } from "lucide-react";

import { addManagerAction, assignVenueAction, setActiveAction, type ManagerFormState } from "@/app/(dashboard)/admin/managers/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { PropertyManager } from "@/lib/admin/property-managers";
import { cn } from "@/lib/utils";

type VenueOption = { id: string; name: string; area: string };

const IDLE: ManagerFormState = { status: "idle" };

const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

function Outcome({ state }: { state: ManagerFormState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={cn("text-meta", state.status === "error" ? "text-rose" : "text-sage")}>
      {state.message}
    </p>
  );
}

/**
 * Admin: invite property managers, link each to a venue, move them between
 * venues and switch their sign-in on or off. The venue link is what the
 * property portal and its live updates key on.
 */
export function PropertyUserManager({ managers, venues }: { managers: PropertyManager[]; venues: VenueOption[] }) {
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  const covered = new Set(managers.filter((m) => m.active).map((m) => m.venueId));
  const uncovered = venues.filter((v) => !covered.has(v.id));

  return (
    <div className="grid gap-8">
      <AddManagerForm venues={venues} />

      <section aria-labelledby="managers-heading" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="managers-heading" className="text-section text-fg font-semibold">
            Property managers
          </h2>
          <p className="text-fg-subtle text-meta">
            {uncovered.length === 0 ? "Every venue has an active manager." : `No active manager: ${uncovered.map((v) => v.name).join(", ")}`}
          </p>
        </div>

        {managers.length === 0 ? (
          <p className="panel text-fg-subtle p-6 text-meta">No property managers yet. Invite one above: they&apos;ll see their venue&apos;s requests in the property portal.</p>
        ) : (
          <div className="table-frame">
            <table className="w-full min-w-[44rem] text-meta">
              <thead>
                <tr className="border-line bg-surface-hover border-b">
                  <th scope="col" className="table-head h-10 px-4 text-left">Manager</th>
                  <th scope="col" className="table-head h-10 px-4 text-left">Venue</th>
                  <th scope="col" className="table-head h-10 px-4 text-left">Status</th>
                  <th scope="col" className="table-head h-10 px-4 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => (
                  <tr key={m.userId} className="border-line border-b align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="text-fg font-medium">{m.name ?? m.email}</p>
                      <p className="text-fg-subtle text-caption">
                        {m.name ? m.email : null}
                        {m.phone ? <span className="figure">{m.name ? " · " : ""}{m.phone}</span> : null}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <AssignVenue manager={m} venues={venues} current={venueName.get(m.venueId) ?? "Unknown venue"} />
                    </td>
                    <td className="px-4 py-3">
                      {!m.active ? (
                        <Badge variant="secondary">inactive</Badge>
                      ) : m.pending ? (
                        <Badge variant="warning">invited</Badge>
                      ) : (
                        <Badge variant="success">active</Badge>
                      )}
                      <p className="text-fg-subtle mt-1 text-caption">{m.lastSignInAt ? `Last sign-in ${when.format(new Date(m.lastSignInAt))}` : `Added ${when.format(new Date(m.createdAt))}`}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ToggleActive manager={m} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function AddManagerForm({ venues }: { venues: VenueOption[] }) {
  const [state, action, pending] = useActionState(addManagerAction, IDLE);
  const err = (f: keyof NonNullable<ManagerFormState["fieldErrors"]>) => state.fieldErrors?.[f];
  return (
    <form action={action} className="panel grid gap-4 p-6" aria-labelledby="add-manager-heading">
      <div>
        <h2 id="add-manager-heading" className="text-section text-fg font-semibold">
          Invite a property manager
        </h2>
        <p className="text-fg-subtle mt-1 text-meta">They get an email to set a password, then see the venue&apos;s inbound requests in the property portal.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="pm-name" label="Name" error={err("name")}>
          <Input id="pm-name" name="name" autoComplete="off" required maxLength={80} aria-invalid={Boolean(err("name"))} />
        </Field>
        <Field id="pm-email" label="Email" error={err("email")}>
          <Input id="pm-email" name="email" type="email" autoComplete="off" required aria-invalid={Boolean(err("email"))} />
        </Field>
        <Field id="pm-phone" label="Mobile (optional)" error={err("phone")}>
          <Input id="pm-phone" name="phone" type="tel" placeholder="98450 12345" aria-invalid={Boolean(err("phone"))} />
        </Field>
        <Field id="pm-venue" label="Venue" error={err("venue_id")}>
          <NativeSelect id="pm-venue" name="venue_id" required defaultValue="" aria-invalid={Boolean(err("venue_id"))}>
            <option value="" disabled>
              Choose a venue
            </option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.area}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />} Invite manager
        </Button>
        <Outcome state={state} />
      </div>
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-destructive text-caption">{error}</p> : null}
    </div>
  );
}

function AssignVenue({ manager, venues, current }: { manager: PropertyManager; venues: VenueOption[]; current: string }) {
  const [state, action, pending] = useActionState(assignVenueAction, IDLE);
  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="user_id" value={manager.userId} />
      <div className="flex items-center gap-2">
        <NativeSelect
          name="venue_id"
          defaultValue={manager.venueId}
          aria-label={`Venue for ${manager.name ?? manager.email} (now ${current})`}
          // Saves on change: one choice, no extra click.
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          disabled={pending}
          className="h-8 min-w-48"
        >
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </NativeSelect>
        {pending ? <Loader2 className="text-fg-subtle size-4 animate-spin" aria-label="Saving" /> : null}
      </div>
      <Outcome state={state} />
    </form>
  );
}

function ToggleActive({ manager }: { manager: PropertyManager }) {
  const [state, action, pending] = useActionState(setActiveAction, IDLE);
  return (
    <form action={action} className="grid justify-items-end gap-1.5">
      <input type="hidden" name="user_id" value={manager.userId} />
      <input type="hidden" name="active" value={manager.active ? "false" : "true"} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Power aria-hidden />} {manager.active ? "Deactivate" : "Reactivate"}
      </Button>
      <Outcome state={state} />
    </form>
  );
}
