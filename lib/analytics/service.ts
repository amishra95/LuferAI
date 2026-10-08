import "server-only";

import type { Member } from "@/lib/auth/session";
import { financialYear } from "@/lib/fiscal-year";
import { roundInr, todayInIndia } from "@/lib/gst-engine";
import { listBookings, listCompanies, listDepartments as listCompanyDepartments, type BookingDetail } from "@/lib/data";
import {
  analyzeSpend,
  budgetOutlook,
  forecastSpend,
  monthlySpend,
  monthRange,
  type BudgetOutlook,
  type FinanceBooking,
  type ForecastMonth,
  type SpendAnalysis,
  type SpendGroupBy,
  type SpendPeriod,
} from "./finance";

/**
 * Whose numbers a caller may see. Client users are pinned to their company;
 * admins see the platform and may narrow to one company. Resolved from the
 * session in /api/chat, never from model output.
 */
export type AnalyticsScope = { kind: "platform" } | { kind: "company"; companyId: string; companyName: string };

/** Admins see the platform; client users their own company; everyone else nothing. */
export async function analyticsScopeFor(member: Pick<Member, "role" | "companyId">): Promise<AnalyticsScope | null> {
  if (member.role === "ADMIN") return { kind: "platform" };
  if (member.role !== "CLIENT" || !member.companyId) return null;
  const company = (await listCompanies()).find((c) => c.id === member.companyId);
  return company ? { kind: "company", companyId: company.id, companyName: company.legal_name.replace(" Private Limited", "") } : null;
}

interface Department {
  id: string;
  name: string;
  company_id: string;
  annual_budget_inr: number;
}

async function listDepartments(companyIds?: string[]): Promise<Department[]> {
  return (await listCompanyDepartments({ companyIds })).map(({ id, name, company_id, annual_budget_inr }) => ({ id, name, company_id, annual_budget_inr }));
}

function toFinance(bookings: BookingDetail[], departments: Map<string, string>): FinanceBooking[] {
  return bookings.map((b) => ({
    event_date: b.event_date,
    status: b.status,
    total_amount_inr: Number(b.total_amount_inr),
    gst_inr: b.invoice.total_tax,
    invoice_total_inr: b.invoice.invoice_total,
    party_size: b.party_size,
    list_per_head_inr: b.list_budget_per_head_inr != null ? Number(b.list_budget_per_head_inr) : null,
    venue: b.venue.name,
    company: b.company.legal_name.replace(" Private Limited", ""),
    department: b.department_id ? departments.get(b.department_id) ?? null : null,
    cost_center: b.cost_center ?? null,
  }));
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Narrow the caller's scope to one company by name (admins only; a client's
 * scope is already one company and the filter is ignored).
 */
async function resolveCompanies(scope: AnalyticsScope, companyFilter?: string | null): Promise<{ ids: string[] | null; label: string } | { error: string }> {
  if (scope.kind === "company") return { ids: [scope.companyId], label: scope.companyName };
  if (!companyFilter?.trim()) return { ids: null, label: "all companies" };
  const matches = (await listCompanies()).filter((c) => norm(c.legal_name).includes(norm(companyFilter)));
  if (matches.length === 0) return { error: `No company matches "${companyFilter}".` };
  return { ids: matches.map((c) => c.id), label: matches.map((c) => c.legal_name.replace(" Private Limited", "")).join(", ") };
}

async function load(ids: string[] | null) {
  const [bookings, departments] = await Promise.all([
    ids?.length === 1 ? listBookings({ companyId: ids[0] }) : listBookings(),
    listDepartments(ids ?? undefined),
  ]);
  const scoped = ids ? bookings.filter((b) => ids.includes(b.company_id)) : bookings;
  return { bookings: scoped, departments };
}

export type SpendToolResult = (SpendAnalysis & { scope: string; currency: "INR"; note: string }) | { error: string };

export async function runSpendAnalysis(
  scope: AnalyticsScope,
  input: { period: SpendPeriod; groupBy: SpendGroupBy; company?: string | null }
): Promise<SpendToolResult> {
  const companies = await resolveCompanies(scope, input.company);
  if ("error" in companies) return companies;
  const { bookings, departments } = await load(companies.ids);
  const names = new Map(departments.map((d) => [d.id, d.name]));
  const analysis = analyzeSpend(toFinance(bookings, names), input, todayInIndia());
  return {
    ...analysis,
    scope: companies.label,
    currency: "INR",
    note: "spend = pre-GST taxable value of non-cancelled bookings by event date; GST is reclaimable as input tax credit",
  };
}

export type ForecastToolResult =
  | {
      scope: string;
      currency: "INR";
      period: { from: string; to: string; label: string };
      basis: string;
      history: { month: string; spend: number }[];
      forecast: ForecastMonth[];
      projectedPeriodTotal: number;
      budget: (BudgetOutlook & { source: string }) | null;
      note: string;
    }
  | { error: string };

/**
 * Forecast spend from the current month to the end of the financial year (or
 * `horizonMonths` ahead), from the last 12 complete months plus what's already
 * booked, and compare it to a budget: an explicit amount, a department's annual
 * budget, or the company's monthly spend limit × 12.
 */
export async function runBudgetForecast(
  scope: AnalyticsScope,
  input: { horizonMonths?: number | null; department?: string | null; costCenter?: string | null; budgetInr?: number | null; company?: string | null }
): Promise<ForecastToolResult> {
  const companies = await resolveCompanies(scope, input.company);
  if ("error" in companies) return companies;
  const { bookings, departments } = await load(companies.ids);
  let rows = toFinance(bookings, new Map(departments.map((d) => [d.id, d.name])));
  const filters: string[] = [];

  let department: Department | undefined;
  if (input.department?.trim()) {
    const found = departments.filter((d) => norm(d.name).includes(norm(input.department!)));
    if (found.length === 0) return { error: `No department matches "${input.department}".` };
    if (found.length > 1 && !found.every((d) => d.name === found[0].name)) {
      return { error: `"${input.department}" matches several departments: ${found.map((d) => d.name).join(", ")}. Be more specific.` };
    }
    department = found.length === 1 ? found[0] : undefined;
    const names = new Set(found.map((d) => d.name));
    rows = rows.filter((r) => r.department && names.has(r.department));
    filters.push(`department ${found[0].name}`);
  }
  if (input.costCenter?.trim()) {
    rows = rows.filter((r) => r.cost_center && norm(r.cost_center) === norm(input.costCenter!));
    filters.push(`cost centre ${input.costCenter.trim().toUpperCase()}`);
  }

  const today = todayInIndia();
  const fy = financialYear(today);
  const thisMonth = today.slice(0, 7);
  const [y, m] = thisMonth.split("-").map(Number);
  const monthStart = (offset: number) => new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);

  // Forecast: this month through the FY end, or `horizonMonths` months (1–24) from this one.
  const horizon = Math.min(Math.max(Math.round(input.horizonMonths ?? 0), 0), 24);
  const futureMonths = monthRange(`${thisMonth}-01`, horizon > 0 ? monthStart(horizon - 1) : fy.end);

  // History: the 12 complete months before this one.
  const historyMonths = monthRange(monthStart(-12), monthStart(-1));
  const history = monthlySpend(rows, historyMonths);
  const committed = monthlySpend(rows, futureMonths);
  const forecast = forecastSpend(
    history,
    futureMonths.map((month, i) => ({ month, committed: committed[i] }))
  );

  const periodEnd = futureMonths.at(-1)!;
  // Budget period: the financial year (department budgets and spend limits are annual).
  const fyMonthsDone = monthRange(fy.start, today).filter((mo) => mo < thisMonth);
  const spentThisFy = monthlySpend(rows, fyMonthsDone).reduce((s, v) => s + v, 0);
  // Budgets always project to the FY end, whatever horizon the caller asked to see.
  const fyRest = monthRange(`${thisMonth}-01`, fy.end);
  const fyCommitted = monthlySpend(rows, fyRest);
  const fyForecast = forecastSpend(history, fyRest.map((month, i) => ({ month, committed: fyCommitted[i] })));

  let budget: (BudgetOutlook & { source: string }) | null = null;
  if (input.budgetInr && input.budgetInr > 0) {
    budget = { ...budgetOutlook(roundInr(input.budgetInr), roundInr(spentThisFy), fyForecast), source: "the budget you gave" };
  } else if (department && department.annual_budget_inr > 0) {
    budget = { ...budgetOutlook(department.annual_budget_inr, roundInr(spentThisFy), fyForecast), source: `${department.name}'s ${fy.label} budget` };
  } else if (!input.department && !input.costCenter && companies.ids?.length === 1) {
    const company = (await listCompanies()).find((c) => c.id === companies.ids![0]);
    const limit = Number(company?.monthly_spend_limit_inr ?? 0);
    if (limit > 0) budget = { ...budgetOutlook(roundInr(limit * 12), roundInr(spentThisFy), fyForecast), source: `monthly spend limit × 12 for ${fy.label}` };
  }

  return {
    scope: [companies.label, ...filters].join(" · "),
    currency: "INR",
    period: { from: `${futureMonths[0]}-01`, to: periodEnd, label: horizon > 0 ? `next ${horizon} month${horizon === 1 ? "" : "s"}` : `rest of ${fy.label}` },
    basis:
      history.filter((v) => v > 0).length >= 4
        ? "linear trend over the last 12 complete months, floored at already-booked spend"
        : "average monthly run-rate (too little history for a trend), floored at already-booked spend",
    history: historyMonths.map((month, i) => ({ month, spend: history[i] })),
    forecast,
    projectedPeriodTotal: forecast.reduce((s, f) => s + f.projected, 0),
    budget,
    note: "pre-GST spend; low/high is an ~80% band; budgets are compared over the financial year",
  };
}
