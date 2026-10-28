import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { BudgetManager } from "@/components/governance/budget-manager";
import { ContractRequirement } from "@/components/governance/contract-requirement";
import { HierarchyEditor } from "@/components/governance/hierarchy-editor";
import { RequestBoard } from "@/components/governance/request-board";
import { RuleManager } from "@/components/governance/rule-manager";
import { SsoConnections } from "@/components/governance/sso-connections";
import { listSsoConnections } from "@/lib/auth/sso-store";
import { requireWorkspace } from "@/lib/auth/session";
import { dataSource, listCompanies, listDepartments, listPortalUsers } from "@/lib/data";
import { budgetTone } from "@/lib/procurement/po-ledger";
import { canManageGovernance } from "@/lib/services/enterprise/access";
import { isOverdue, levelsNeeded } from "@/lib/services/enterprise/approvalEngine";
import { getHierarchy, listApprovalRequests, listBudgets, listRules } from "@/lib/services/enterprise/governanceStore";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Governance" };

const shortName = (legal: string) => legal.replace(" Private Limited", "");

export default async function GovernancePage({ searchParams }: PageProps<"/governance">) {
  const member = await requireWorkspace("/governance");
  const { company: companyParam } = await searchParams;

  const all = await listCompanies();
  const companies = member.role === "ADMIN" ? all : all.filter((c) => c.id === member.companyId);
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();

  const [users, departments, hierarchy, { rules, ready }, budgets, requests, sso] = await Promise.all([
    listPortalUsers({ companyId: company.id }),
    listDepartments({ companyIds: [company.id] }),
    getHierarchy(company.id),
    listRules(company.id),
    listBudgets(company.id),
    listApprovalRequests(company.id),
    listSsoConnections(company.id).catch((err) => {
      console.error("governance: could not load SSO connections", err);
      return { connections: [], ready: false };
    }),
  ]);

  const canManage = canManageGovernance(member);
  const now = new Date();
  const pending = requests.filter((r) => r.outcome === "pending");
  const overdue = pending.filter((r) => r.steps.some((s) => isOverdue(s.approval, now))).length;
  const activeRules = rules.filter((r) => r.is_active).length;
  const atRisk = budgets.budgets.filter((b) => budgetTone({ usedPct: b.balance.usedPct, overrun: b.balance.overrun }) !== "ok").length;
  const shortChain = levelsNeeded(rules) > hierarchy.length;
  const unavailable = dataSource() !== "supabase" ? "rules and budgets need Supabase" : !ready ? "needs migration 0030" : null;

  const stats = [
    { label: "Awaiting sign-off", value: pending.length },
    { label: "Past deadline", value: overdue, warn: overdue > 0 },
    { label: "Active rules", value: activeRules },
    { label: "Budgets near or over", value: atRisk, warn: atRisk > 0 },
  ];

  return (
    <Page>
      <PageHeader
        title="Governance"
        description={`Who signs off ${shortName(company.legal_name)}'s spend, in what order, above which amounts, and how much each team can commit per month or quarter.`}
        badge={
          <>
            {unavailable ? <NoticePill>{unavailable}</NoticePill> : null}
            {!canManage ? <NoticePill>view only</NoticePill> : null}
          </>
        }
      />

      {companies.length > 1 ? (
        <nav aria-label="Company" className="mb-6 flex flex-wrap gap-2">
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/governance?company=${c.id}`}
              aria-current={c.id === company.id ? "page" : undefined}
              className={cn("pill min-h-8", c.id === company.id && "border-fg text-fg")}
            >
              {shortName(c.legal_name)}
            </Link>
          ))}
        </nav>
      ) : null}

      <dl className="mb-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="panel p-5">
            <dt className="label-mono">{s.label}</dt>
            <dd className={cn("figure text-fg mt-1 text-section", s.warn && "text-warn")}>{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <HierarchyEditor
          companyId={member.role === "ADMIN" ? company.id : null}
          tiers={hierarchy}
          candidates={users.filter((u) => u.role === "APPROVER").map((u) => ({ id: u.id, name: u.name }))}
          canManage={canManage && !unavailable}
          warning={shortChain ? `Your rules ask for up to ${levelsNeeded(rules)} levels, but the chain has ${hierarchy.length}. Requests in those bands can't be submitted until you add approvers.` : null}
        />
        <RuleManager
          companyId={member.role === "ADMIN" ? company.id : null}
          rules={rules}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          canManage={canManage && !unavailable}
        />
      </div>

      <BudgetManager
        companyId={member.role === "ADMIN" ? company.id : null}
        budgets={budgets.budgets}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        canManage={canManage && !unavailable}
        today={now.toISOString().slice(0, 10)}
      />

      <ContractRequirement
        companyId={member.role === "ADMIN" ? company.id : null}
        required={company.contracts_required}
        canManage={canManage && dataSource() === "supabase"}
      />

      <SsoConnections
        companyId={member.role === "ADMIN" ? company.id : null}
        connections={sso.connections}
        canManage={member.role === "ADMIN"}
        unavailable={dataSource() !== "supabase" ? "needs Supabase" : !sso.ready ? "needs migration 20261108000000" : null}
      />

      <RequestBoard
        companyId={member.role === "ADMIN" ? company.id : null}
        pending={pending}
        recent={requests.filter((r) => r.outcome !== "pending").slice(0, 8)}
        canEscalate={canManage && dataSource() === "supabase"}
        now={now.toISOString()}
      />
    </Page>
  );
}
