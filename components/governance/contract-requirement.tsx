"use client";

import { useState } from "react";
import { FileSignature, Loader2 } from "lucide-react";

import { setContractsRequiredAction } from "@/app/(dashboard)/contracts/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { useAction } from "@/components/workspace/use-optimistic-mutation";

/**
 * Whether the company confirms bookings by signed contract (companies.contracts_required):
 * once a booking is with the venue, a Venue Services Agreement is issued, an Approver
 * signs, the venue countersigns, and that confirms the booking and schedules its invoices.
 */
export function ContractRequirement({ companyId, required, canManage }: { companyId: string | null; required: boolean; canManage: boolean }) {
  const [on, setOn] = useState(required);
  const act = useAction<{ required: boolean }>();
  const toggle = async () => {
    const next = !on;
    const outcome = await act.run(() => setContractsRequiredAction(companyId, next), {
      failure: "Couldn't change the contract setting",
      success: (r) => ({ tone: "success", title: r.required ? "Bookings now need a signed contract" : "Venues confirm bookings directly again" }),
    });
    if (outcome?.ok) setOn(next);
  };

  return (
    <section aria-labelledby="contracts-heading" className="mt-10">
      <SectionLabel>
        <span id="contracts-heading">Contracts</span>
      </SectionLabel>
      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <FileSignature className="text-fg-subtle size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-fg text-meta font-medium">{on ? "Bookings are confirmed by signed contract" : "Venues confirm bookings directly"}</p>
          <p className="text-fg-subtle mt-0.5 text-meta leading-5">
            When on, a booking with the venue gets a Venue Services Agreement. An Approver signs, the venue countersigns, and that confirms the booking and issues the deposit and balance invoices.
          </p>
        </div>
        {canManage ? (
          <button type="button" role="switch" aria-checked={on} className="btn" disabled={act.pending} onClick={toggle}>
            {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {on ? "Turn off" : "Require contracts"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
