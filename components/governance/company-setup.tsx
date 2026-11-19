"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { companySetupAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { OFFICE_AREAS, type OfficeAreaKey } from "@/lib/companies/setup";

type Values = { gstin: string; billingAddress: string; officeArea: OfficeAreaKey | "" };

/**
 * The company's GSTIN (added once, if it signed up without one: bookings need
 * it), billing address (the "Bill to" on tax invoices, which wait for it) and
 * office area (distance on venue cards, the distance rule). Booking rules are
 * on the Rules tab (policy-rules.tsx).
 */
export function CompanySetup({
  companyId,
  initial,
  canManage,
}: {
  companyId: string | null;
  initial: { gstin: string | null; billingAddress: string | null; officeArea: string | null };
  canManage: boolean;
}) {
  const [values, setValues] = useState<Values>({
    gstin: "",
    billingAddress: initial.billingAddress ?? "",
    officeArea: (initial.officeArea ?? "") as OfficeAreaKey | "",
  });
  const act = useAction<{ ok: true }>();
  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [key]: e.target.value }) as Values);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await act.run(() => companySetupAction(companyId, values), {
      failure: "Couldn't save company details",
      success: () => ({ tone: "success", title: "Company details saved" }),
    });
  };

  return (
    <section id="setup" aria-labelledby="setup-heading" className="mb-10">
      <SectionLabel>
        <span id="setup-heading">Company details</span>
      </SectionLabel>
      <form onSubmit={save} className="panel grid gap-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
            <span className="text-fg text-meta font-medium">GSTIN</span>
            {initial.gstin ? (
              <input value={initial.gstin} readOnly disabled className="field font-mono" />
            ) : (
              <>
                <input
                  value={values.gstin}
                  onChange={(e) => setValues((v) => ({ ...v, gstin: e.target.value.toUpperCase() }))}
                  disabled={!canManage}
                  maxLength={15}
                  autoCapitalize="characters"
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  aria-describedby="gstin-hint"
                  className="field font-mono uppercase"
                />
                <span id="gstin-hint" className="text-fg-subtle text-caption">
                  Needed before your first booking
                </span>
              </>
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
        </div>

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
