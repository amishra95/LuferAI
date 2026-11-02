import "server-only";

import { listBookings, listCompanies } from "@/lib/data";
import { latestPayments } from "@/lib/payments/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataSource } from "@/lib/data";
import { buildMonthlyStatement, STATEMENT_STATUSES, type MonthlyStatement, type StatementPayment } from "./monthly-statement";

/** All captured payments for the bookings (a booking can have a deposit and a balance). */
async function capturedPayments(bookingIds: string[]): Promise<StatementPayment[]> {
  if (bookingIds.length === 0) return [];
  if (dataSource() !== "supabase") {
    // Redis/mock keep no payments table; fall back to the latest payment per booking.
    return [...(await latestPayments(bookingIds)).values()].map((p) => ({ booking_id: p.booking_id!, status: p.status, amount_inr: Number(p.amount_inr) }));
  }
  const { data, error } = await createAdminClient().from("payments").select("booking_id, status, amount_inr").in("booking_id", bookingIds).eq("status", "captured");
  if (error) throw error;
  return data.filter((p) => p.booking_id).map((p) => ({ booking_id: p.booking_id!, status: p.status, amount_inr: Number(p.amount_inr) }));
}

/** One company's statement for a month (YYYY-MM), or null when the company doesn't exist. */
export async function loadMonthlyStatement(companyId: string, month: string): Promise<MonthlyStatement | null> {
  const company = (await listCompanies()).find((c) => c.id === companyId);
  if (!company) return null;
  const bookings = (await listBookings({ companyId })).filter((b) => STATEMENT_STATUSES.has(b.status) && b.event_date.startsWith(`${month}-`));
  const payments = await capturedPayments(bookings.map((b) => b.id));
  return buildMonthlyStatement({ company: { id: company.id, legal_name: company.legal_name, gstin: company.gstin }, month, bookings, payments });
}
