import "server-only";

import { assignApprovers } from "@/lib/approvals/route";
import { validateExpense, type ExpenseInput } from "@/lib/bookings/expense";
import { priceOrder, unitNoun, type Category, type OrderInput } from "@/lib/catalog/items";
import { createCatalogOrder, listCatalogItems, listCompanies, listDepartments, listPoAllocations, listPortalUsers, listPurchaseOrders, PoAllocationError } from "@/lib/data";
import { calculateGst, todayInIndia, type TaxInvoicePayload } from "@/lib/gst-engine";
import { checkBookingPolicy } from "@/lib/policies/checkBookingPolicy";
import { selectPo } from "@/lib/procurement/po-ledger";
import type { Json } from "@/lib/supabase/database.types";

export interface PlaceOrderInput {
  companyId: string;
  /** The requesting employee: an Organizer or Approver at the company. */
  userId: string;
  itemId: string;
  order: OrderInput;
  departmentId?: string | null;
  expense: ExpenseInput;
  notes?: string;
  poId?: string | null;
}

export interface PlaceOrderResult {
  status: "success" | "error";
  message: string;
  orderId?: string;
  partnerId?: string;
  orderStatus?: "PENDING_APPROVAL" | "PLACED";
  approval?: { reason: string; approverName: string; tiers: number };
  invoice?: TaxInvoicePayload;
}

const CAN_REQUEST = new Set(["ORGANIZER", "APPROVER"]);

/**
 * The one ordering path for catalogue items (the client portal and the booking
 * agent): validates and prices the order for its category, taxes it at the
 * item's HSN/SAC rate, checks the company's spend policy (alcohol included),
 * draws from a blanket PO, and routes for sign-off when needed, exactly as
 * venue bookings do. Callers revalidate.
 */
export async function placeCatalogOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const fail = (message: string): PlaceOrderResult => ({ status: "error", message });
  const [companies, users, [item]] = await Promise.all([listCompanies(), listPortalUsers({ companyId: input.companyId }), listCatalogItems({ ids: [input.itemId] })]);
  const company = companies.find((c) => c.id === input.companyId);
  if (!company) return fail("Unknown company account.");
  const requester = users.find((u) => u.id === input.userId);
  if (!requester) return fail(`Only a signed-in employee of ${company.legal_name} can order.`);
  if (!CAN_REQUEST.has(requester.role ?? "")) return fail(`${requester.name} has the Finance viewer role, which can't order. Ask an Organizer.`);
  if (!item) return fail("That item isn't available.");
  if (!item.partner_gstin) return fail(`${item.partner_name} hasn't added a GSTIN yet, so it can't invoice. Choose another supplier.`);

  const departmentId = input.departmentId || null;
  if (departmentId && !(await listDepartments({ companyIds: [company.id] })).some((d) => d.id === departmentId)) return fail("Unknown department.");
  const expense = validateExpense(input.expense, company.gstin);
  if (!expense.ok) return fail(Object.values(expense.errors)[0] ?? "Check the cost centre.");

  const priced = priceOrder(item, input.order, todayInIndia());
  if (!priced.ok) return fail(priced.error);
  const p = priced.value;
  const date = p.eventDate ?? p.neededBy!;

  const invoice = calculateGst({
    total_amount: p.total,
    company_gstin: expense.value.billing_gstin ?? company.gstin,
    venue_gstin: item.partner_gstin,
    tax: p.tax,
    ...(p.placeOfSupplyState && { place_of_supply_state_code: p.placeOfSupplyState }),
  });

  // The same spend policy as venue bookings, on what the company pays per unit.
  const policy = await checkBookingPolicy({
    tenant_id: company.id,
    total_amount: p.total,
    headcount: p.quantity,
    per_head_amount: p.perHead,
    event_date: date,
    alcohol_included: p.alcohol,
    unit: unitNoun(item.category as Category, p.quantity),
  });
  if (policy.blocked) return fail(`This order can't be placed: ${policy.reason}.`);

  const [pos, allocations] = await Promise.all([listPurchaseOrders({ tenantId: company.id }), listPoAllocations({ tenantId: company.id })]);
  const po = selectPo(pos, allocations, { tenantId: company.id, eventDate: date, departmentId, amount: p.total, poId: input.poId });
  if (po.kind === "ineligible") return fail(`${po.reason}. Ask your approver or finance team to raise or extend a purchase order.`);

  const reasons = [policy.requiresApproval ? policy.reason : null, po.kind === "over_balance" ? po.reason : null].filter((r): r is string => Boolean(r));
  const routed = await assignApprovers({
    companyId: company.id,
    companyName: company.legal_name,
    requesterId: input.userId,
    users,
    reasons,
    tiers: policy.requiresApproval ? policy.tiers : 1,
  });
  if (!routed.ok) return fail(routed.message);

  try {
    const order = await createCatalogOrder(
      {
        tenant_id: company.id,
        item_id: item.id,
        partner_id: item.partner_id,
        category: item.category,
        quantity: p.quantity,
        unit_price_inr: p.unitPrice,
        total_amount_inr: p.total,
        invoice: invoice as unknown as Json,
        event_date: p.eventDate,
        needed_by: p.neededBy,
        selections: p.selections as Json,
        recipients: p.recipients as unknown as Json,
        department_id: departmentId,
        cost_center: expense.value.cost_center,
        project_code: expense.value.project_code,
        requested_by: input.userId,
        notes: input.notes?.trim().slice(0, 500) || null,
      },
      {
        approvals: routed.approvals,
        allocation: po.kind === "ok" || po.kind === "over_balance" ? { po_id: po.po.id, over_balance: po.kind === "over_balance" } : undefined,
      }
    );
    const base = { status: "success" as const, orderId: order.id, partnerId: item.partner_id, orderStatus: order.status as "PENDING_APPROVAL" | "PLACED", invoice };
    if (routed.approvals.length) {
      return {
        ...base,
        message: `Order submitted: ${routed.approvals.length > 1 ? "requires manager and senior sign-off" : "requires manager sign-off"} before ${item.partner_name} sees it.`,
        approval: { reason: reasons.join("; "), approverName: routed.approverNames.join(", then "), tiers: routed.approvals.length },
      };
    }
    return { ...base, message: `Order sent to ${item.partner_name}.` };
  } catch (err) {
    if (err instanceof PoAllocationError) return fail(`${err.message}. Try again, or choose another purchase order.`);
    console.error("catalog: could not place order", err);
    return fail("Could not place the order. Try again.");
  }
}
