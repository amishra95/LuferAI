import "server-only";

import { dataSource } from "@/lib/data";
import type { DispatchOutcome } from "@/lib/finance/export-dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExpenseSyncStatus } from "@/lib/supabase/database.types";

const SYNC_STATUS: Record<DispatchOutcome["status"], ExpenseSyncStatus> = { delivered: "synced", skipped: "synced", mocked: "mocked", failed: "failed" };

/**
 * Records a booking's expense export on its virtual cards (migration 0033), so
 * each card shows whether its itemised receipt reached Concur / Brex / Ramp.
 * Never throws: the export itself already succeeded or failed on its own terms.
 */
export async function markCardReceipts(bookingId: string, outcome: DispatchOutcome): Promise<void> {
  if (dataSource() !== "supabase") return;
  const status = SYNC_STATUS[outcome.status];
  const { error } = await createAdminClient()
    .from("virtual_cards")
    .update({
      expense_sync_status: status,
      expense_synced_at: status === "failed" ? null : new Date().toISOString(),
      expense_error: outcome.status === "failed" ? outcome.error.slice(0, 500) : null,
    })
    .eq("booking_id", bookingId)
    .neq("status", "cancelled");
  // 42P01: migration 0033 not applied, so there are no cards to update.
  if (error && error.code !== "42P01") console.error(`card receipts: couldn't record export for booking ${bookingId}`, error.message);
}
