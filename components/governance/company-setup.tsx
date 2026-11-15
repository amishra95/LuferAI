"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { companySetupAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { OFFICE_AREAS, type OfficeAreaKey } from "@/lib/companies/setup";

type Values = { gstin: string; billingAddress: string; officeArea: OfficeAreaKey | ""; autoApprovePerHead: string; managerPerHead: string; maxPerHead: string; maxDistanceKm: string };

const str = (n: number | null | undefined) => (n == null ? "" : String(n));

/**
 * The company's GSTIN (added once, if it signed up without one: bookings need
 * it), billing address (the "Bill to" on tax invoices, which wait for it), office area (distance on venue cards, the distance rule) and per-head
 * approval tiers (the policy badge on venue cards). Blank = no limit.
 */
export function CompanySetup({
  companyId,
  initial,
  canManage,
}: {
  companyId: string | null;
  initial: { gstin: string | null; billingAddress: string | null; officeArea: string | null; autoApprovePerHead: number | null; managerPerHead: number | null; maxPerHead: number | null; maxDistanceKm: number | null };
  canManage: boolean;
}) {
  const [values, setValues] = useState<Values>({
    gstin: "",
    billingAddress: initial.billingAddress ?? "",
    officeArea: (initial.officeArea ?? "") as OfficeAreaKey | "",
    autoApprovePerHead: str(initial.autoApprovePerHead),
    managerPerHead: str(initial.managerPerHead),
    maxPerHead: str(initial.maxPerHead),
    maxDistanceKm: str(initial.maxDistanceKm),
  });
  const act = useAction<{ ok: true }>();
  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [key]: e.target.value }) as Values);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await act.run(() => companySetupAction(companyId, values), {
      failure: "Couldn't save company setup",
      success: () => ({ tone: "success", title: "Company setup saved" }),
    });
  };

  const money = (key: "autoApprovePerHead" | "managerPerHead" | "maxPerHead", label: string) => (
    <label className="grid gap-1.5">
      <span className="text-fg text-meta font-medium">{label}</span>
      <div className="relative">
        <span className="text-fg-subtle pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-meta">₹</span>
        <input type="number" inputMode="numeric" min={0} step={50} value={values[key]} onChange={set(key)} disabled={!canManage} className="field pl-7 font-mono" placeholder="No limit" />
      </div>
    </label>
  );

  return (
    <section id="setup" aria-labelledby="setup-heading" className="mb-10">
      <SectionLabel>
        <span id="setup-heading">Company setup</span>
      </SectionLabel>
      <form onSubmit={save} className="panel grid gap-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
            <span className="text-fg text-meta font-medium">GSTIN</span>
            {initial.gstin ? (
              <input value={initial.gstin} readOnly disabled className="field font-mono" />
            ) : (
              <input
                value={values.gstin}
                onChange={(e) => setValues((v) => ({ ...v, gstin: e.target.value.toUpperCase() }))}
                disabled={!canManage}
                maxLength={15}
                autoCapitalize="characters"
                className="field font-mono uppercase"
              />
            )}
          </label>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-fg text-meta font-medium">Billing address</span>
            <textarea
              value={values.billingAddress}
              onChange={set("billingAddress")}
              disabled={!canManage}
              rows={2}
              maxLength={500}
              autoComplete="street-address"
              className="field field-sizing-content h-auto min-h-16 resize-none py-2"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-fg text-meta font-medium">Office area</span>
            <select value={values.officeArea} onChange={set("officeArea")} disabled={!canManage} className="field">
              <option value="">Not set</option>
              {OFFICE_AREAS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-fg text-meta font-medium">Max distance from office</span>
            <div className="relative">
              <input type="number" inputMode="decimal" min={0} step={1} value={values.maxDistanceKm} onChange={set("maxDistanceKm")} disabled={!canManage} className="field pr-10 font-mono" placeholder="No limit" />
              <span className="text-fg-subtle pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-meta">km</span>
            </div>
          </label>
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="label-mono mb-3">Per head, before GST</legend>
          {money("autoApprovePerHead", "Auto-approved up to")}
          {money("managerPerHead", "Manager approval up to")}
          {money("maxPerHead", "Never above")}
        </fieldset>

        {canManage ? (
          <div>
            <button type="submit" className="btn btn-primary" disabled={act.pending}>
              {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              Save
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
