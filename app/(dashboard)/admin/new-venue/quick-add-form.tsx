"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";

import { OFFICE_AREAS } from "@/lib/companies/setup";
import { DIETARY_TAGS, dietaryLabel } from "@/lib/quotes";
import { cn } from "@/lib/utils";
import { quickAddVenueAction, type QuickAddState } from "./actions";

type Pkg = { name: string; perHead: string; dietary: (typeof DIETARY_TAGS)[number][] };

const EMPTY = {
  name: "",
  area: "",
  address: "",
  capacity: "",
  privateRoom: false,
  servesAlcohol: true,
  minSpend: "",
  gstin: "",
  managerEmail: "",
  managerName: "",
};
const emptyPackages = (): Pkg[] => [0, 1, 2].map(() => ({ name: "", perHead: "", dietary: [] }));

/**
 * One form per venue signed offline: details, up to three packages, GSTIN
 * (live at once) and the manager (invited by email). After saving, the form
 * clears for the next venue and links to the venue's page for photos.
 */
export function QuickAddForm() {
  const [v, setV] = useState(EMPTY);
  const [packages, setPackages] = useState<Pkg[]>(emptyPackages);
  const [state, setState] = useState<QuickAddState | null>(null);
  const [pending, start] = useTransition();
  const field = (k: keyof typeof EMPTY) => ({
    value: v[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value })),
    "aria-invalid": state && !state.ok && state.field === k ? true : undefined,
  });
  const setPkg = (i: number, patch: Partial<Pkg>) => setPackages((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const result = await quickAddVenueAction({ ...v, area: v.area as never, packages });
      setState(result);
      if (result.ok) {
        setV(EMPTY);
        setPackages(emptyPackages());
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  };

  return (
    <div className="grid max-w-3xl gap-6">
      {state?.ok ? (
        <div role="status" className="panel border-sage/40 flex flex-wrap items-start gap-3 p-4">
          <CheckCircle2 className="text-sage mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 text-meta">
            <p className="text-fg font-medium">
              {state.name} {state.result.published ? "is live" : "is saved, unlisted until it has a GSTIN"} · {state.result.packages} package
              {state.result.packages === 1 ? "" : "s"}
            </p>
            {state.result.paused.length ? <p className="text-fg-subtle">Concierge listing paused: {state.result.paused.join(", ")}</p> : null}
            {state.result.manager ? (
              <p className="text-fg-subtle">
                Manager: {state.result.manager === "invited" ? "invited by email" : state.result.manager === "linked" ? "existing account linked" : state.result.manager}
              </p>
            ) : null}
          </div>
          <Link href={`/property?venue=${state.result.venueId}`} className="btn h-8">
            Add photos
          </Link>
        </div>
      ) : state ? (
        <p role="alert" className="text-destructive text-meta">
          {state.error}
        </p>
      ) : null}

      <form onSubmit={submit} className="grid gap-6">
        <fieldset className="panel grid gap-4 p-5 sm:grid-cols-2">
          <legend className="label-mono mb-1">Venue</legend>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-fg text-meta font-medium">Name</span>
            <input required className="field" {...field("name")} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-fg text-meta font-medium">Area</span>
            <select required className="field" {...field("area")}>
              <option value="">Pick an area</option>
              {OFFICE_AREAS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-fg text-meta font-medium">Max guests</span>
            <input required type="number" min={2} inputMode="numeric" className="field font-mono" {...field("capacity")} />
          </label>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-fg text-meta font-medium">Address</span>
            <input required className="field" {...field("address")} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-fg text-meta font-medium">Minimum spend (₹, pre-GST)</span>
            <input type="number" min={0} inputMode="numeric" className="field font-mono" placeholder="None" {...field("minSpend")} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-fg text-meta font-medium">GSTIN</span>
            <input className="field font-mono uppercase placeholder:font-sans placeholder:normal-case" maxLength={15} placeholder="Optional" {...field("gstin")} />
          </label>
          <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
            <label className="text-fg flex items-center gap-2 text-meta">
              <input type="checkbox" checked={v.privateRoom} onChange={(e) => setV((s) => ({ ...s, privateRoom: e.target.checked }))} /> Private dining room
            </label>
            <label className="text-fg flex items-center gap-2 text-meta">
              <input type="checkbox" checked={v.servesAlcohol} onChange={(e) => setV((s) => ({ ...s, servesAlcohol: e.target.checked }))} /> Serves alcohol
            </label>
          </div>
        </fieldset>

        <fieldset className="panel grid gap-4 p-5">
          <legend className="label-mono mb-1">Packages</legend>
          {packages.map((p, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <input className="field" placeholder={i === 0 ? "e.g. Team dinner set menu" : `Package ${i + 1}`} value={p.name} onChange={(e) => setPkg(i, { name: e.target.value })} aria-label={`Package ${i + 1} name`} />
              <div className="relative">
                <span className="text-fg-subtle pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-meta">₹</span>
                <input type="number" min={1} inputMode="numeric" className="field pl-7 font-mono" placeholder="per head" value={p.perHead} onChange={(e) => setPkg(i, { perHead: e.target.value })} aria-label={`Package ${i + 1} price per head`} />
              </div>
              {p.name ? (
                <div className="flex flex-wrap gap-1.5 sm:col-span-2" role="group" aria-label={`Package ${i + 1} dietary`}>
                  {DIETARY_TAGS.map((t) => {
                    const on = p.dietary.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPkg(i, { dietary: on ? p.dietary.filter((x) => x !== t) : [...p.dietary, t] })}
                        className={cn("h-7 rounded-md border px-2.5 text-caption", on ? "border-fg bg-surface-raised text-fg" : "border-line text-fg-subtle hover:text-fg")}
                      >
                        {dietaryLabel(t)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </fieldset>

        <fieldset className="panel grid gap-4 p-5 sm:grid-cols-2">
          <legend className="label-mono mb-1">Manager</legend>
          <label className="grid gap-1.5">
            <span className="text-fg text-meta font-medium">Email</span>
            <input type="email" className="field" placeholder="Optional" {...field("managerEmail")} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-fg text-meta font-medium">Name</span>
            <input className="field" {...field("managerName")} />
          </label>
        </fieldset>

        <div>
          <button type="submit" className="btn btn-primary h-10 px-5" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {v.gstin ? "Add and publish" : "Add venue"}
          </button>
        </div>
      </form>
    </div>
  );
}
