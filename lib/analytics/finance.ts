/**
 * Financial analytics and budget forecasting for the concierge's analyzeSpend
 * and forecastBudget tools. Pure (tested in tests/finance-analytics.test.mjs):
 * the model only chooses parameters; every number comes from here.
 *
 * "Spend" is the pre-GST taxable value of committed bookings (anything not
 * CANCELLED), matching the admin spend analytics; GST is reported separately
 * because companies reclaim it as input tax credit. Dates are event dates.
 */
import { financialYear } from "../fiscal-year.ts";
import { roundInr, sumInr } from "../gst-engine.ts";

export interface FinanceBooking {
  event_date: string; // YYYY-MM-DD
  status: string;
  /** Pre-GST taxable amount. */
  total_amount_inr: number;
  gst_inr: number;
  invoice_total_inr: number;
  party_size: number;
  /** List per-head before the corporate rate card (null = list pricing applied). */
  list_per_head_inr: number | null;
  venue: string;
  company: string;
  department: string | null;
  cost_center: string | null;
}

export const SPEND_PERIODS = ["this_month", "last_30_days", "last_90_days", "fytd", "last_fy", "next_90_days", "all"] as const;
export type SpendPeriod = (typeof SPEND_PERIODS)[number];

export const SPEND_GROUPS = ["month", "venue", "department", "cost_center", "company", "status"] as const;
export type SpendGroupBy = (typeof SPEND_GROUPS)[number];

export interface PeriodRange {
  from: string;
  to: string;
  label: string;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const monthOf = (date: string) => date.slice(0, 7);

export function resolvePeriod(period: SpendPeriod, today: string): PeriodRange {
  const fy = financialYear(today);
  switch (period) {
    case "this_month":
      return { from: `${monthOf(today)}-01`, to: today, label: "this month to date" };
    case "last_30_days":
      return { from: addDays(today, -29), to: today, label: "the last 30 days" };
    case "last_90_days":
      return { from: addDays(today, -89), to: today, label: "the last 90 days" };
    case "fytd":
      return { from: fy.start, to: today, label: `${fy.label} to date` };
    case "last_fy": {
      const prev = financialYear(addDays(fy.start, -1));
      return { from: prev.start, to: prev.end, label: prev.label };
    }
    case "next_90_days":
      return { from: addDays(today, 1), to: addDays(today, 90), label: "the next 90 days (committed)" };
    case "all":
      return { from: "0000-01-01", to: "9999-12-31", label: "all time" };
  }
}

export const isCommitted = (b: Pick<FinanceBooking, "status">) => b.status !== "CANCELLED";

/** Rate-card savings: list per-head (snapshotted when priced) minus what was charged. */
export const savingsOf = (b: FinanceBooking) =>
  b.list_per_head_inr == null ? 0 : roundInr(Math.max(0, b.party_size * b.list_per_head_inr - b.total_amount_inr));

const KEY: Record<SpendGroupBy, (b: FinanceBooking) => string> = {
  month: (b) => monthOf(b.event_date),
  venue: (b) => b.venue,
  department: (b) => b.department ?? "No department",
  cost_center: (b) => b.cost_center ?? "No cost centre",
  company: (b) => b.company,
  status: (b) => b.status,
};

export interface SpendRow {
  key: string;
  bookings: number;
  spend: number;
  share: number; // % of total spend, 1 decimal
}

export interface SpendAnalysis {
  period: PeriodRange;
  groupBy: SpendGroupBy;
  totals: { bookings: number; guests: number; spend: number; gst: number; invoiceTotal: number; savings: number; avgPerHead: number };
  rows: SpendRow[];
  /** Rows folded into "Other" when there were more than `limit` groups. */
  otherGroups: number;
}

export function analyzeSpend(
  bookings: readonly FinanceBooking[],
  input: { period: SpendPeriod; groupBy: SpendGroupBy; includeCancelled?: boolean },
  today: string,
  limit = 12
): SpendAnalysis {
  const period = resolvePeriod(input.period, today);
  const scoped = bookings.filter(
    (b) => b.event_date >= period.from && b.event_date <= period.to && (input.includeCancelled || input.groupBy === "status" || isCommitted(b))
  );
  const counted = scoped.filter(isCommitted);
  const spend = sumInr(counted.map((b) => b.total_amount_inr));
  const guests = counted.reduce((n, b) => n + b.party_size, 0);

  const groups = new Map<string, { bookings: number; spend: number }>();
  for (const b of scoped) {
    const g = groups.get(KEY[input.groupBy](b)) ?? { bookings: 0, spend: 0 };
    g.bookings++;
    if (isCommitted(b)) g.spend = sumInr([g.spend, b.total_amount_inr]);
    groups.set(KEY[input.groupBy](b), g);
  }
  const share = (v: number) => (spend > 0 ? Math.round((v / spend) * 1000) / 10 : 0);
  let rows: SpendRow[] = [...groups].map(([key, g]) => ({ key, bookings: g.bookings, spend: g.spend, share: share(g.spend) }));
  rows = input.groupBy === "month" ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.spend - a.spend || a.key.localeCompare(b.key));

  let otherGroups = 0;
  if (input.groupBy !== "month" && rows.length > limit) {
    const rest = rows.slice(limit - 1);
    otherGroups = rest.length;
    const otherSpend = sumInr(rest.map((r) => r.spend));
    rows = [...rows.slice(0, limit - 1), { key: "Other", bookings: rest.reduce((n, r) => n + r.bookings, 0), spend: otherSpend, share: share(otherSpend) }];
  }

  return {
    period,
    groupBy: input.groupBy,
    totals: {
      bookings: counted.length,
      guests,
      spend,
      gst: sumInr(counted.map((b) => b.gst_inr)),
      invoiceTotal: sumInr(counted.map((b) => b.invoice_total_inr)),
      savings: sumInr(counted.map(savingsOf)),
      avgPerHead: guests > 0 ? roundInr(spend / guests) : 0,
    },
    rows,
    otherGroups,
  };
}

/** YYYY-MM keys from `from` to `to` inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = monthOf(from).split("-").map(Number);
  const end = monthOf(to);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    if (m === 12) {
      m = 1;
      y++;
    } else {
      m++;
    }
  }
  return out;
}

/** Committed spend per month for the given months (missing months are 0). */
export function monthlySpend(bookings: readonly FinanceBooking[], months: readonly string[]): number[] {
  const totals = new Map(months.map((m) => [m, 0]));
  for (const b of bookings) {
    const m = monthOf(b.event_date);
    if (isCommitted(b) && totals.has(m)) totals.set(m, sumInr([totals.get(m)!, b.total_amount_inr]));
  }
  return months.map((m) => totals.get(m)!);
}

/** Least-squares line through (0, v0), (1, v1), … plus the residual standard deviation. */
export function linearTrend(values: readonly number[]): { slope: number; intercept: number; residualSd: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0, residualSd: 0 };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  values.forEach((v, x) => {
    sxy += (x - meanX) * (v - meanY);
    sxx += (x - meanX) ** 2;
  });
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - slope * meanX;
  const residuals = values.map((v, x) => v - (intercept + slope * x));
  const residualSd = n > 2 ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (n - 2)) : 0;
  return { slope, intercept, residualSd };
}

export interface ForecastMonth {
  month: string;
  /** Already booked (committed) for that month. */
  committed: number;
  /** Trend estimate from history. */
  trend: number;
  /** max(committed, trend): spend can't come in below what's already booked. */
  projected: number;
  low: number;
  high: number;
}

/** z for an ~80% band. */
const Z80 = 1.28;
/** With fewer active months than this, a line is noise: use the average run-rate. */
const MIN_MONTHS_FOR_TREND = 4;

/**
 * Forecast monthly spend: a linear trend over the history (or the average
 * run-rate when history is thin), floored at what's already committed for
 * each future month, with an ~80% band from the trend's residuals.
 */
export function forecastSpend(history: readonly number[], futureCommitted: readonly { month: string; committed: number }[]): ForecastMonth[] {
  const active = history.filter((v) => v > 0).length;
  const fit =
    active >= MIN_MONTHS_FOR_TREND
      ? linearTrend(history)
      : { slope: 0, intercept: history.length ? history.reduce((s, v) => s + v, 0) / history.length : 0, residualSd: 0 };
  const sd = active >= MIN_MONTHS_FOR_TREND ? fit.residualSd : fit.intercept * 0.25;

  return futureCommitted.map(({ month, committed }, i) => {
    const trend = roundInr(Math.max(0, fit.intercept + fit.slope * (history.length + i)));
    const projected = Math.max(committed, trend);
    return {
      month,
      committed,
      trend,
      projected,
      low: roundInr(Math.max(committed, trend - Z80 * sd)),
      high: roundInr(Math.max(committed, trend + Z80 * sd)),
    };
  });
}

export interface BudgetOutlook {
  budget: number;
  /** Spend in completed months of the budget period (the forecast covers the current month on). */
  spentToDate: number;
  projectedTotal: number;
  projectedUtilisationPct: number;
  remaining: number;
  /** First month in which cumulative projected spend passes the budget, or null. */
  exhaustionMonth: string | null;
  status: "on_track" | "at_risk" | "over_budget";
}

/** Where a budget lands if spend follows the forecast. */
export function budgetOutlook(budget: number, spentToDate: number, forecast: readonly ForecastMonth[]): BudgetOutlook {
  let cumulative = spentToDate;
  let exhaustionMonth: string | null = spentToDate > budget ? "already" : null;
  for (const f of forecast) {
    cumulative = sumInr([cumulative, f.projected]);
    if (!exhaustionMonth && cumulative > budget) exhaustionMonth = f.month;
  }
  const projectedTotal = cumulative;
  return {
    budget,
    spentToDate,
    projectedTotal,
    projectedUtilisationPct: budget > 0 ? Math.round((projectedTotal / budget) * 1000) / 10 : 0,
    remaining: roundInr(budget - spentToDate),
    exhaustionMonth: exhaustionMonth === "already" ? null : exhaustionMonth,
    status: spentToDate > budget ? "over_budget" : projectedTotal > budget ? "at_risk" : "on_track",
  };
}
