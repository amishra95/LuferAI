"use server";

import { refresh, revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import type { OrderInput } from "@/lib/catalog/items";
import { isOrderStatus, type OrderStatus } from "@/lib/catalog/orders";
import { placeCatalogOrder } from "@/lib/catalog/place-order";
import { CatalogError, listCatalogOrders, listPortalUsers, updateCatalogOrderStatus } from "@/lib/data";
import { exportOrderExpense } from "@/lib/finance/export-dispatcher";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { publishExpense, publishOrder } from "@/lib/telemetry/live";

/**
 * Buyer-side catalogue mutations for the client portal's Catalogue tab. Each
 * returns an ActionResult for the optimistic UI and publishes an `order` event.
 */

function revalidateOrderViews() {
  revalidatePath("/client");
  revalidatePath("/client/approvals");
  revalidatePath("/partner");
  revalidatePath("/admin");
  refresh();
}

/** The signed-in client user and company (catalogue orders are always a company's). */
async function buyer() {
  const member = await requirePortal("/client");
  if (member.role !== "CLIENT" || !member.companyId) throw new ActionError("Orders are placed by a company's Organizers or Approvers.");
  return { member, companyId: member.companyId };
}

export interface CatalogOrderRequest {
  itemId: string;
  order: OrderInput;
  costCenter: string;
  projectCode?: string;
  departmentId?: string | null;
  notes?: string;
  poId?: string | null;
}

export interface PlacedOrder {
  orderId: string;
  partnerId: string;
  status: "PENDING_APPROVAL" | "PLACED";
  message: string;
}

export async function placeCatalogOrderAction(request: CatalogOrderRequest): Promise<ActionResult<PlacedOrder>> {
  return serverDispatch(
    "client/placeCatalogOrder",
    async () => {
      const { member, companyId } = await buyer();
      const result = await placeCatalogOrder({
        companyId,
        userId: member.userId,
        itemId: String(request.itemId ?? ""),
        order: request.order ?? { quantity: 0 },
        departmentId: request.departmentId ?? null,
        expense: { costCenter: request.costCenter, projectCode: request.projectCode ?? null },
        notes: request.notes,
        poId: request.poId ?? null,
      });
      if (result.status !== "success" || !result.orderId) throw new ActionError(result.message);
      revalidateOrderViews();
      return { orderId: result.orderId, partnerId: result.partnerId!, status: result.orderStatus!, message: result.message };
    },
    { emit: (o) => publishOrder(o.orderId, o.partnerId, o.status, "buyer") }
  );
}

/** The buyer cancels before the supplier ships (or before sign-off completes). */
export async function cancelCatalogOrderAction(orderId: string): Promise<ActionResult<{ orderId: string; partnerId: string }>> {
  return serverDispatch(
    "client/cancelCatalogOrder",
    async () => {
      const { companyId } = await buyer();
      try {
        const order = await updateCatalogOrderStatus(orderId, "CANCELLED", { tenantId: companyId });
        revalidateOrderViews();
        return { orderId: order.id, partnerId: order.partner_id };
      } catch (err) {
        throw err instanceof CatalogError ? new ActionError(err.message) : err;
      }
    },
    { emit: (o) => publishOrder(o.orderId, o.partnerId, "CANCELLED", "buyer") }
  );
}

export interface OrderExpenseSync {
  orderId: string;
  partnerId: string;
  provider: string;
  export: "delivered" | "mocked" | "failed" | "skipped";
  settled: boolean;
  error?: string;
}

/**
 * Exports a confirmed order to the company's expense system (or retries a
 * failed export) and, once it's DELIVERED and recorded, settles it.
 * Approvers for their own company, and admins.
 */
export async function syncOrderExpenseAction(orderId: string): Promise<ActionResult<OrderExpenseSync>> {
  return serverDispatch(
    "client/syncOrderExpense",
    async () => {
      const member = await requirePortal("/client");
      let tenantId: string | undefined;
      if (member.role === "CLIENT") {
        const actor = member.companyId ? (await listPortalUsers({ companyId: member.companyId })).find((u) => u.id === member.userId) : undefined;
        if (actor?.role !== "APPROVER") throw new ActionError("Only Approvers (or admins) can sync orders to the expense system.");
        tenantId = member.companyId!;
      } else if (member.role !== "ADMIN") {
        throw new ActionError("You can't sync expenses.");
      }
      const [order] = await listCatalogOrders({ ids: [orderId], ...(tenantId && { tenantId }) });
      if (!order) throw new ActionError("Order not found.");
      const status = order.status as OrderStatus;
      if (!isOrderStatus(status) || !["CONFIRMED", "SHIPPED", "DELIVERED", "SETTLED"].includes(status)) throw new ActionError("Only confirmed orders can be synced to expenses.");
      const result = await exportOrderExpense(orderId);
      if (result.status === "failed" && !result.provider) throw new ActionError(result.error);
      let settled = false;
      if (status === "DELIVERED" && result.status !== "failed") {
        await updateCatalogOrderStatus(orderId, "SETTLED", { tenantId: order.tenant_id });
        settled = true;
      }
      revalidateOrderViews();
      return { orderId, partnerId: order.partner_id, provider: result.provider ?? "webhook", export: result.status, settled, ...(result.status === "failed" && { error: result.error }) };
    },
    {
      emit: async (r) => {
        await publishExpense(r.orderId, r.provider, r.export);
        if (r.settled) await publishOrder(r.orderId, r.partnerId, "SETTLED", "expense");
      },
    }
  );
}
