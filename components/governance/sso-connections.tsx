"use client";

import { useState } from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";

import { addSsoConnectionAction, updateSsoConnectionAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import type { CompanySsoConnection } from "@/lib/supabase/database.types";

const ROLE_LABEL = { ORGANIZER: "Organizer", APPROVER: "Approver", FINANCE_VIEWER: "Finance viewer" } as const;

/**
 * The company's single sign-on domains: employees on a connected domain sign
 * in through the company's identity provider and join as `default_role` the
 * first time. Lufer admins connect them after registering the SAML
 * provider in Supabase Auth; the company's own users see them read-only.
 */
export function SsoConnections({
  companyId,
  connections,
  canManage,
  unavailable,
}: {
  companyId: string | null;
  connections: CompanySsoConnection[];
  canManage: boolean;
  unavailable: string | null;
}) {
  const act = useAction<{ ok: true }>();
  const [adding, setAdding] = useState(false);

  const add = async (form: FormData) => {
    const outcome = await act.run(
      () =>
        addSsoConnectionAction(companyId, {
          domain: String(form.get("domain") ?? ""),
          providerId: String(form.get("provider_id") ?? ""),
          defaultRole: String(form.get("default_role") ?? ""),
        }),
      { failure: "Couldn't connect the domain", success: () => ({ tone: "success", title: "Domain connected. Employees can sign in with SSO." }) }
    );
    if (outcome?.ok) setAdding(false);
  };
  const update = (id: string, change: "enable" | "disable" | "remove") =>
    act.run(() => updateSsoConnectionAction(companyId, { id, change }), {
      failure: "Couldn't update single sign-on",
      success: () => ({ tone: "success", title: change === "remove" ? "Domain disconnected" : change === "enable" ? "SSO sign-up turned on" : "SSO sign-up paused" }),
    });

  return (
    <section aria-labelledby="sso-heading" className="mt-10">
      <SectionLabel>
        <span id="sso-heading">Single sign-on</span>
      </SectionLabel>
      <div className="panel grid gap-4 p-5">
        <div className="flex gap-4">
          <KeyRound className="text-fg-subtle mt-0.5 size-5 shrink-0" aria-hidden />
          <p className="text-fg-subtle text-meta leading-5">
            Employees on a connected domain choose &ldquo;Continue with company SSO&rdquo; and sign in through your identity provider (Okta, Entra ID, Google Workspace). The first time, they join
            with the default role below, with no application to approve. {unavailable ? `Unavailable: ${unavailable}.` : null}
          </p>
        </div>

        {connections.length ? (
          <ul className="divide-line divide-y">
            {connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
                <span className="text-fg min-w-0 flex-1 font-mono text-meta">
                  @{c.domain}
                  <span className="text-fg-subtle font-sans"> · joins as {ROLE_LABEL[c.default_role]}</span>
                  {!c.enabled ? <span className="text-warn font-sans"> · paused</span> : null}
                </span>
                {canManage ? (
                  <span className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={act.pending} onClick={() => update(c.id, c.enabled ? "disable" : "enable")}>
                      {c.enabled ? "Pause" : "Resume"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={act.pending} onClick={() => update(c.id, "remove")} aria-label={`Disconnect ${c.domain}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-subtle text-meta">No domains connected. {canManage ? "" : "Ask Lufer support to set up SSO for your company."}</p>
        )}

        {canManage && !unavailable ? (
          adding ? (
            <form action={add} className="border-line grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1.4fr_1fr_auto] sm:items-end">
              <label className="grid gap-1 text-meta">
                <span className="text-fg-subtle">Email domain</span>
                <Input name="domain" placeholder="acme.com" required autoFocus />
              </label>
              <label className="grid gap-1 text-meta">
                <span className="text-fg-subtle">Supabase SSO provider id</span>
                <Input name="provider_id" placeholder="from `supabase sso list`" required className="font-mono" />
              </label>
              <label className="grid gap-1 text-meta">
                <span className="text-fg-subtle">New employees join as</span>
                <NativeSelect name="default_role" defaultValue="ORGANIZER">
                  {Object.entries(ROLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={act.pending}>
                  {act.pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Connect
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                <Plus aria-hidden /> Connect a domain
              </Button>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
