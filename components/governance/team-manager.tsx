"use client";

import { useState } from "react";
import { Loader2, UserPlus, X } from "lucide-react";

import { inviteTeammateAction, removeTeammateAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { Pill } from "@/components/portal/pills";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { roleLabel, TEAM_ROLES, type TeamRole } from "@/lib/companies/team";

export interface TeamRow {
  id: string;
  email: string;
  role: string | null;
  pending: boolean;
}

/**
 * The company's people. Approvers add colleagues by email (they join at once
 * and get an email to sign in) and remove them; everyone else sees the list.
 */
export function TeamManager({ companyId, team, selfId, canManage }: { companyId: string | null; team: TeamRow[]; selfId: string; canManage: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("ORGANIZER");
  const invite = useAction<{ email: string; emailed: boolean }>();
  const remove = useAction<{ ok: true }>();
  const [removing, setRemoving] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const outcome = await invite.run(() => inviteTeammateAction(companyId, { email, role }), {
      failure: "Couldn't add them",
      success: (r) => ({ tone: "success", title: r.emailed ? `Added ${r.email} and emailed them` : `Added ${r.email}. They can sign in with that address.` }),
    });
    if (outcome?.ok) setEmail("");
  };

  const drop = async (m: TeamRow) => {
    setRemoving(m.id);
    await remove.run(() => removeTeammateAction(companyId, m.id), {
      failure: "Couldn't remove them",
      success: () => ({ tone: "success", title: `Removed ${m.email}` }),
    });
    setRemoving(null);
  };

  return (
    <section id="team" aria-labelledby="team-heading" className="mb-10">
      <SectionLabel>
        <span id="team-heading">Team</span>
      </SectionLabel>
      <div className="panel overflow-hidden">
        <ul>
          {team.map((m) => (
            <li key={m.id} className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-3 last:border-b-0">
              <span className="text-fg min-w-0 flex-1 truncate text-meta">
                {m.email}
                {m.id === selfId ? <span className="text-fg-subtle"> (you)</span> : null}
              </span>
              {m.pending ? <Pill tone="neutral">Invited</Pill> : null}
              <span className="text-fg-muted text-caption">{roleLabel(m.role)}</span>
              {canManage && m.id !== selfId ? (
                <button
                  type="button"
                  onClick={() => drop(m)}
                  disabled={removing === m.id}
                  className="btn btn-ghost btn-icon size-7"
                  aria-label={`Remove ${m.email}`}
                  title="Remove"
                >
                  {removing === m.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form onSubmit={submit} className="border-line bg-surface-hover/40 flex flex-wrap items-end gap-2 border-t px-5 py-4">
            <label className="grid min-w-56 flex-[2_1_16rem] gap-1.5">
              <span className="text-fg text-meta font-medium">Work email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field" autoComplete="off" />
            </label>
            <label className="grid flex-[1_1_9rem] gap-1.5">
              <span className="text-fg text-meta font-medium">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)} className="field">
                {TEAM_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary h-9" disabled={invite.pending}>
              {invite.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <UserPlus className="size-3.5" aria-hidden />}
              Add
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
