import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { BudgetManager } from "@/components/governance/budget-manager";
import { CompanySetup } from "@/components/governance/company-setup";
import { PolicyRulesEditor } from "@/components/governance/policy-rules";
import { segmentClass } from "@/components/portal/segment";
import { rulesFromRows } from "@/lib/policies/policy-rules";
import { TeamManager } from "@/components/governance/team-manager";
import { listTeam } from "@/lib/companies/team-store";
import { officeAreaKeyOf } from "@/lib/companies/setup";
import { ContractRequirement } from "@/components/governance/contract-requirement";
import { HierarchyEditor } from "@/components/governance/hierarchy-editor";
import { PunchoutConnections } from "@/components/governance/punchout-connections";
import { RequestBoard } from "@/components/governance/request-board";
import { RuleManager } from "@/components/governance/rule-manager";
import { SsoConnections } from "@/components/governance/sso-connections";
import { listSsoConnections } from "@/lib/auth/sso-store";
import { requireWorkspace } from "@/lib/auth/session";
import { dataSource, getCorporatePolicy, listCompanies, listDepartments, listPortalUsers } from "@/lib/data";
import { budgetTone } from "@/lib/procurement/po-ledger";
import { canManageGovernance } from "@/lib/services/enterprise/access";
import { isOverdue, levelsNeeded } from "@/lib/services/enterprise/approvalEngine";
import { getHierarchy, listApprovalRequests, listBudgets, listRules } from "@/lib/services/enterprise/governanceStore";
import { cn } from "@/lib/utils";
import { listPunchoutConnections } from "@/lib/punchout/store";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = { title: "Policies" };

const shortName = (legal: string) => legal.replace(" Private Limited", "");

const TABS = { rules: "Rules", approvals: "Approvals", budgets: "Budgets", team: "Team", company: "Company" } as const;
type Tab = keyof typeof TABS;
const isTab = (v: unknown): v is Tab => typeof v === "string" && Object.hasOwn(TABS, v);

export default async function GovernancePage({ searchParams }: PageProps<"/governance">) {
  const member = await requireWorkspace("/governance");
  const { company: companyParam, tab: tabParam } = await searchParams;
  const tab: Tab = isTab(tabParam) ? tabParam : "rules";

  const all = await listCompanies();
  const companies = member.role === "ADMIN" ? all : all.filter((c) => c.id === member.companyId);
  const company = typeof companyParam === "string" ? companies.find((c) => c.id === companyParam) : companies[0];
  if (!company) notFound();
  // Runs alongside the loads below.
  const punchoutLoad = listPunchoutConnections(company.id).catch((err) => {
    console.error("governance: could not load punchout connections", err);
    return { connections: [], orders: [], ready: false };
  });

  const [users, departments, hierarchy, { rules, ready }, budgets, requests, sso, policy] = await Promise.all([
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
    getCorporatePolicy(company.id),
  ]);
  const team = dataSource() === "supabase"
    ? await listTeam(company.id).catch((err) => {
        console.error("governance: could not load the team", err);
        return null;
      })
    : null;

  const canManage = canManageGovernance(member);
  const punchout = await punchoutLoad;
  const site = siteUrl("https://lufer.app");
  const admin = member.role === "ADMIN";
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

  const tabHref = (t: Tab) => {
    const q = new URLSearchParams();
    if (admin && companies.length > 1) q.set("company", company.id);
    if (t !== "rules") q.set("tab", t);
    const qs = q.toString();
    return qs ? `/governance?${qs}` : "/governance";
  };

  return (
    <Page>
      <PageHeader
        title="Policies"
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
              href={`/governance?company=${c.id}${tab !== "rules" ? `&tab=${tab}` : ""}`}
              aria-current={c.id === company.id ? "page" : undefined}
              className={cn("pill min-h-8", c.id === company.id && "border-fg text-fg")}
            >
              {shortName(c.legal_name)}
            </Link>
          ))}
        </nav>
      ) : null}

      <nav aria-label="Policies sections" className="border-line -mx-1 mb-8 flex gap-1 overflow-x-auto border-b px-1 pb-2">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link key={t} href={tabHref(t)} scroll={false} aria-current={t === tab ? "page" : undefined} className={cn(segmentClass(t === tab), "shrink-0")}>
            {TABS[t]}
            {t === "approvals" && pending.length > 0 ? <span className="bg-accent text-on-accent ml-1.5 rounded-full px-1.5 font-mono text-caption tabular-nums">{pending.length}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "rules" ? (
        <PolicyRulesEditor companyId={admin ? company.id : null} initial={rulesFromRows(policy, company.monthly_spend_limit_inr)} canManage={canManage && dataSource() === "supabase"} />
      ) : null}

      {tab === "approvals" ? (
        <>
          {/* Counts only once there's something to count. The one that needs someone leads, wider and larger. */}
          {stats.some((s) => s.value > 0) ? (
            <dl className="mb-8 grid grid-cols-2 gap-6 sm:grid-cols-5">
              {stats.map((s, i) => (
                <div key={s.label} className={cn("panel p-5", i === 0 && "col-span-2")}>
                  <dt className="label-mono">{s.label}</dt>
                  <dd className={cn("figure text-fg mt-1", i === 0 ? "text-title" : "text-section", s.warn && "text-warn")}>{s.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <RequestBoard
            companyId={admin ? company.id : null}
            pending={pending}
            recent={requests.filter((r) => r.outcome !== "pending").slice(0, 8)}
            canEscalate={canManage && dataSource() === "supabase"}
            now={now.toISOString()}
          />

          <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <HierarchyEditor
              companyId={admin ? company.id : null}
              tiers={hierarchy}
              candidates={users.filter((u) => u.role === "APPROVER").map((u) => ({ id: u.id, name: u.name }))}
              canManage={canManage && !unavailable}
              warning={shortChain ? `Your rules ask for up to ${levelsNeeded(rules)} levels, but the chain has ${hierarchy.length}. Requests in those bands can't be submitted until you add approvers.` : null}
            />
            <RuleManager
              companyId={admin ? company.id : null}
              rules={rules}
              departments={departments.map((d) => ({ id: d.id, name: d.name }))}
              canManage={canManage && !unavailable}
            />
          </div>
        </>
      ) : null}

      {tab === "budgets" ? (
        <BudgetManager
          companyId={admin ? company.id : null}
          budgets={budgets.budgets}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          canManage={canManage && !unavailable}
          today={now.toISOString().slice(0, 10)}
        />
      ) : null}

      {tab === "team" ? (
        team ? <TeamManager companyId={admin ? company.id : null} team={team} selfId={member.userId} canManage={canManage} /> : <p className="text-fg-subtle text-body">The team is managed on the live database.</p>
      ) : null}

      {tab === "company" ? (
        <>
          <CompanySetup
            companyId={admin ? company.id : null}
            canManage={canManage && dataSource() === "supabase"}
            initial={{ gstin: company.gstin, billingAddress: company.billing_address, officeArea: officeAreaKeyOf(company) }}
          />

          <ContractRequirement companyId={admin ? company.id : null} required={company.contracts_required} canManage={canManage && dataSource() === "supabase"} />

          {/* SSO and punchout are set up by Lufer: companies see them once connected. */}
          {admin || sso.connections.length > 0 ? (
            <SsoConnections
              companyId={admin ? company.id : null}
              connections={sso.connections}
              canManage={admin}
              unavailable={dataSource() !== "supabase" ? "needs Supabase" : !sso.ready ? "needs migration 20261108000000" : null}
            />
          ) : null}

          {admin || punchout.connections.length > 0 ? (
            <PunchoutConnections
              companyId={admin ? company.id : null}
              connections={punchout.connections}
              orders={punchout.orders}
              endpoints={{ setup: `${site}/api/punchout/setup`, order: `${site}/api/punchout/order` }}
              canManage={admin}
              unavailable={dataSource() !== "supabase" ? "needs Supabase" : !punchout.ready ? "needs migration 20261109000000" : null}
            />
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
