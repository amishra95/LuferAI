import "server-only";

import { financialYear } from "@/lib/fiscal-year";
import { roundInr, sumInr, todayInIndia } from "@/lib/gst-engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataSource, listBookings, type BookingDetail } from "./index";

/**
 * Executive spend analytics for /admin. "Spend" is the pre-GST taxable value
 * (GST is reclaimed as ITC) of committed bookings: anything not cancelled (a
 * rejected approval cancels its booking).
 * Periods follow the Indian financial year (Apr–Mar).
 */

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string; // "Apr"
  spend: number;
  cumulative: number;
  savings: number;
}

export interface DepartmentUsage {
  id: string;
  label: string;
  company: string;
  spent: number;
  budget: number;
  pct: number;
}

export interface SpendAnalytics {
  fyLabel: string;
  months: MonthPoint[];
  fytdSpend: number;
  fytdSavings: number;
  committedAhead: number;
  departments: DepartmentUsage[];
  pendingApprovals: number;
}

const committed = (b: BookingDetail) => b.status !== "CANCELLED";
/** Rate-card savings: list per-head (snapshotted when priced) minus what was charged. */
const savingsOf = (b: BookingDetail) =>
  b.list_budget_per_head_inr == null
    ? 0
    : roundInr(Math.max(0, b.party_size * Number(b.list_budget_per_head_inr) - b.total_amount_inr));

function fyMonths(start: string, through: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const end = through.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    if (m === 12) {
      m = 1;
      y++;
    } else {
      m++;
    }
  }
  return out;
}

export async function getSpendAnalytics(bookings?: BookingDetail[]): Promise<SpendAnalytics> {
  const today = todayInIndia();
  const fy = financialYear(today);
  const all = (bookings ?? (await listBookings())).filter(committed);
  const inFy = all.filter((b) => b.event_date >= fy.start && b.event_date <= fy.end);
  const toDate = inFy.filter((b) => b.event_date <= today);

  let running = 0;
  const months = fyMonths(fy.start, today).map((month) => {
    const rows = toDate.filter((b) => b.event_date.startsWith(month));
    const spend = sumInr(rows.map((b) => b.total_amount_inr));
    running = sumInr([running, spend]);
    return {
      month,
      label: new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }),
      spend,
      cumulative: running,
      savings: sumInr(rows.map(savingsOf)),
    };
  });

  let departments: DepartmentUsage[] = [];
  if (dataSource() === "supabase") {
    const { data } = await createAdminClient()
      .from("departments")
      .select("id, name, annual_budget_inr, company:companies(legal_name)")
      .gt("annual_budget_inr", 0);
    departments = (data ?? [])
      .map((d) => {
        const spent = sumInr(inFy.filter((b) => b.department_id === d.id).map((b) => b.total_amount_inr));
        const budget = Number(d.annual_budget_inr);
        const company = (d.company as { legal_name: string } | null)?.legal_name.replace(" Private Limited", "") ?? "";
        return { id: d.id, label: d.name, company, spent, budget, pct: budget > 0 ? (spent / budget) * 100 : 0 };
      })
      .sort((a, b) => b.pct - a.pct);
  }

  return {
    fyLabel: fy.label,
    months,
    fytdSpend: running,
    fytdSavings: sumInr(toDate.map(savingsOf)),
    committedAhead: sumInr(inFy.filter((b) => b.event_date > today).map((b) => b.total_amount_inr)),
    departments,
    pendingApprovals: all.filter((b) => b.status === "PENDING_APPROVAL").length,
  };
}
