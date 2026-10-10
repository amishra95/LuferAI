"use server";

import { refresh, revalidatePath } from "next/cache";

import { PartnerAccessError, requirePartner } from "@/lib/auth/session";
import { validateItemInput } from "@/lib/catalog/items";
import { isOrderStatus, supplierActions, validateTracking, type OrderStatus } from "@/lib/catalog/orders";
import { CatalogError, listCatalogOrders, saveCatalogItem, setCatalogItemStatus, updateCatalogOrderStatus } from "@/lib/data";
import { exportOrderExpense } from "@/lib/finance/export-dispatcher";
import { validateGstin } from "@/lib/gst-engine";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { recordAudit } from "@/lib/partner/service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CatalogItem, CatalogOrder, Json } from "@/lib/supabase/database.types";
import { publishOrder } from "@/lib/telemetry/live";

/**
 * Supplier-side catalogue mutations for /partner: items (Owners and Managers),
 * order fulfilment (every partner role), and the supplier GSTIN their invoices
 * need (Owners). Admins act for a partner by naming it. Each returns an
 * ActionResult and is audited in the partner log.
 */

/** Partner access and catalogue errors are written for users. */
const asAction = (err: unknown) => (err instanceof PartnerAccessError || err instanceof CatalogError ? new ActionError(err.message) : err);

function revalidateCatalogViews() {
  revalidatePath("/partner");
  revalidatePath("/client");
  revalidatePath("/admin");
  refresh();
}

export async function saveCatalogItemAction(partnerId: string | null, raw: Record<string, unknown>, id?: string): Promise<ActionResult<CatalogItem>> {
  return serverDispatch("partner/saveCatalogItem", async () => {
    try {
      const { member, partnerId: pid } = await requirePartner("catalog.edit", partnerId);
      const valid = validateItemInput(raw);
      if (!valid.ok) throw new ActionError(valid.error);
      const item = await saveCatalogItem(pid, { ...valid.value, attributes: valid.value.attributes as unknown as Json }, id);
      await recordAudit({ partnerId: pid, actorId: member.userId, action: id ? "catalog.updated" : "catalog.created", entity: "catalog_item", entityId: item.id, detail: { ref: item.ref, name: item.name } });
      revalidateCatalogViews();
      return item;
    } catch (err) {
      throw asAction(err);
    }
  });
}

export async function setCatalogItemStatusAction(partnerId: string | null, id: string, status: "active" | "paused"): Promise<ActionResult<CatalogItem>> {
  return serverDispatch("partner/setCatalogItemStatus", async () => {
    try {
      if (status !== "active" && status !== "paused") throw new ActionError("Invalid status.");
      const { member, partnerId: pid } = await requirePartner("listing.status", partnerId);
      const item = await setCatalogItemStatus(pid, id, status);
      await recordAudit({ partnerId: pid, actorId: member.userId, action: status === "paused" ? "catalog.paused" : "catalog.resumed", entity: "catalog_item", entityId: item.id, detail: { name: item.name } });
      revalidateCatalogViews();
      return item;
    } catch (err) {
      throw asAction(err);
    }
  });
}

/**
 * Moves one of the partner's orders on: confirm, ship (with tracking), deliver,
 * or decline/cancel. Confirming exports the order to the buyer's expense system.
 */
export async function fulfilOrderAction(partnerId: string | null, orderId: string, next: OrderStatus, tracking?: unknown): Promise<ActionResult<CatalogOrder>> {
  return serverDispatch(
    "partner/fulfilOrder",
    async () => {
      try {
        const { member, partnerId: pid } = await requirePartner("orders.fulfil", partnerId);
        if (!isOrderStatus(next)) throw new ActionError("Invalid status.");
        const [order] = await listCatalogOrders({ partnerId: pid, ids: [orderId] });
        if (!order || !isOrderStatus(order.status)) throw new ActionError("Order not found.");
        if (!supplierActions(order.category as never, order.status).includes(next)) throw new ActionError(`A ${order.status.toLowerCase()} order can't be marked ${next.toLowerCase()} from here.`);
        let track: Json | undefined;
        if (next === "SHIPPED") {
          const t = validateTracking(tracking);
          if (!t.ok) throw new ActionError(t.error);
          track = t.value as unknown as Json;
        }
        const updated = await updateCatalogOrderStatus(orderId, next, { partnerId: pid }, { tracking: track });
        // The buyer's finance system hears about it once the supplier commits.
        if (next === "CONFIRMED") await exportOrderExpense(orderId);
        await recordAudit({ partnerId: pid, actorId: member.userId, action: `order.${next.toLowerCase()}`, entity: "catalog_order", entityId: orderId, detail: { item: order.item_name, quantity: order.quantity } });
        revalidateCatalogViews();
        return updated;
      } catch (err) {
        throw asAction(err);
      }
    },
    { emit: (o) => publishOrder(o.id, o.partner_id, o.status as OrderStatus, "supplier") }
  );
}

/** The supplier GSTIN catalogue invoices are issued under. Owners only. */
export async function setPartnerGstinAction(partnerId: string | null, gstin: string): Promise<ActionResult<{ gstin: string }>> {
  return serverDispatch("partner/setPartnerGstin", async () => {
    try {
      const { member, partnerId: pid } = await requirePartner("team.manage", partnerId);
      const value = gstin.trim().toUpperCase();
      const check = validateGstin(value);
      if (!check.valid) throw new ActionError(check.reason ?? "Invalid GSTIN.");
      const { error } = await createAdminClient().from("partners").update({ gstin: value }).eq("id", pid);
      if (error) throw error;
      await recordAudit({ partnerId: pid, actorId: member.userId, action: "partner.gstin", entity: "partner", entityId: pid, detail: { gstin: value } });
      revalidateCatalogViews();
      return { gstin: value };
    } catch (err) {
      throw asAction(err);
    }
  });
}
