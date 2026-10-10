"use server";

import { refresh, revalidatePath } from "next/cache";

import { requirePortal, type Member } from "@/lib/auth/session";
import { createPurchaseOrder, listDepartments, listPortalUsers, listPurchaseOrders, PoAllocationError, reallocateBooking, setPurchaseOrderStatus } from "@/lib/data";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { validateNewPo, type NewPoInput } from "@/lib/procurement/po-ledger";
import type { PoAllocation, PurchaseOrder } from "@/lib/supabase/database.types";
import { publishPo } from "@/lib/telemetry/live";

/**
 * Blanket PO mutations for the client portal's Purchase orders tab. Approvers
 * manage their own company's POs; admins any company's (they name it). Each
 * returns an ActionResult for the optimistic UI and publishes a `po` event.
 */

/** The company the caller may manage POs for, or an ActionError. */
async function poTenant(member: Member, companyId: string): Promise<string> {
  if (member.role === "ADMIN") {
    if (!companyId) throw new ActionError("Choose a company.");
    return companyId;
  }
  if (member.role === "CLIENT" && member.companyId) {
    const actor = (await listPortalUsers({ companyId: member.companyId })).find((u) => u.id === member.userId);
    if (actor?.role !== "APPROVER") throw new ActionError("Only Approvers (or admins) manage purchase orders.");
    return member.companyId;
  }
  throw new ActionError("You can't manage purchase orders.");
}

/** PoAllocationError messages are written for users. */
const asAction = (err: unknown) => (err instanceof PoAllocationError ? new ActionError(err.message) : err);

function revalidatePoViews() {
  revalidatePath("/client");
  revalidatePath("/admin");
  refresh();
}

export async function createPurchaseOrderAction(companyId: string, input: NewPoInput): Promise<ActionResult<PurchaseOrder>> {
  return serverDispatch(
    "client/createPurchaseOrder",
    async () => {
      const member = await requirePortal("/client");
      const tenantId = await poTenant(member, companyId);
      const [existing, departments] = await Promise.all([listPurchaseOrders({ tenantId }), listDepartments({ companyIds: [tenantId] })]);
      const valid = validateNewPo(input, existing.map((p) => p.po_number));
      if (!valid.ok) throw new ActionError(valid.error);
      if (valid.value.department_id && !departments.some((d) => d.id === valid.value.department_id)) throw new ActionError("Unknown department.");
      try {
        const po = await createPurchaseOrder(tenantId, valid.value, member.userId);
        revalidatePoViews();
        return po;
      } catch (err) {
        throw asAction(err);
      }
    },
    { emit: (po) => publishPo(po.id, "created") }
  );
}

export async function setPurchaseOrderStatusAction(companyId: string, poId: string, status: "open" | "closed"): Promise<ActionResult<PurchaseOrder>> {
  return serverDispatch(
    "client/setPurchaseOrderStatus",
    async () => {
      const member = await requirePortal("/client");
      if (status !== "open" && status !== "closed") throw new ActionError("Invalid status.");
      const tenantId = await poTenant(member, companyId);
      try {
        const po = await setPurchaseOrderStatus(poId, tenantId, status);
        revalidatePoViews();
        return po;
      } catch (err) {
        throw asAction(err);
      }
    },
    { emit: (po) => publishPo(po.id, po.status === "closed" ? "closed" : "reopened") }
  );
}

/** Moves a booking's spend to another PO (checked like a new allocation: it can't overdraw the target). */
export async function reallocateBookingAction(companyId: string, bookingId: string, poId: string): Promise<ActionResult<PoAllocation>> {
  return serverDispatch(
    "client/reallocateBooking",
    async () => {
      const member = await requirePortal("/client");
      const tenantId = await poTenant(member, companyId);
      try {
        const allocation = await reallocateBooking(bookingId, tenantId, poId);
        revalidatePoViews();
        return allocation;
      } catch (err) {
        throw asAction(err);
      }
    },
    { emit: (a) => publishPo(a.po_id, "reallocated") }
  );
}
