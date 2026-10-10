/**
 * Catalogue order lifecycle (mirrors catalog_orders_guard_status in migration
 * 0021) and the booking agent's item choice. Pure: tests import it directly
 * (tests/catalog.test.mjs).
 *
 *   PENDING_APPROVAL → PLACED → CONFIRMED → [SHIPPED →] DELIVERED → SETTLED
 *   CANCELLED from PENDING_APPROVAL, PLACED or CONFIRMED.
 */
import { containsAlcohol, isCategory, leadTimeDays, SHIPS, validateAttributes, type CatalogItemLike, type Category, type TicketAttributes } from "./items.ts";

export const ORDER_STATUSES = ["PENDING_APPROVAL", "PLACED", "CONFIRMED", "SHIPPED", "DELIVERED", "SETTLED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const isOrderStatus = (v: unknown): v is OrderStatus => typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v);

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_APPROVAL: ["PLACED", "CANCELLED"],
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SHIPPED", "DELIVERED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["SETTLED"],
  SETTLED: [],
  CANCELLED: [],
};

export const canOrderTransition = (from: OrderStatus, to: OrderStatus) => ORDER_TRANSITIONS[from].includes(to);

export const ORDER_STAGE_LABEL: Record<OrderStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  PLACED: "With the supplier",
  CONFIRMED: "Confirmed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
};

/** What the supplier can do next from the extranet. Goods ship; services go straight to delivered. */
export function supplierActions(category: Category, status: OrderStatus): OrderStatus[] {
  if (status === "PLACED") return ["CONFIRMED", "CANCELLED"];
  if (status === "CONFIRMED") return SHIPS[category] ? ["SHIPPED", "CANCELLED"] : ["DELIVERED", "CANCELLED"];
  if (status === "SHIPPED") return ["DELIVERED"];
  return [];
}

/** The PO allocation status an order implies (catalog_orders_sync_po_allocations). */
export function orderAllocationStatus(status: string): "committed" | "consumed" | "released" {
  if (status === "CANCELLED") return "released";
  if (status === "DELIVERED" || status === "SETTLED") return "consumed";
  return "committed";
}

export interface Tracking {
  carrier: string;
  reference: string;
  url?: string;
}

export function validateTracking(raw: unknown): { ok: true; value: Tracking } | { ok: false; error: string } {
  const t = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const carrier = String(t.carrier ?? "").trim();
  const reference = String(t.reference ?? "").trim();
  const url = String(t.url ?? "").trim();
  if (carrier.length < 2 || carrier.length > 60) return { ok: false, error: "Enter the carrier." };
  if (!/^[A-Za-z0-9-]{4,40}$/.test(reference)) return { ok: false, error: "Enter the tracking number." };
  if (url && !/^https:\/\/[^\s]{4,300}$/.test(url)) return { ok: false, error: "The tracking link must be an https:// URL." };
  return { ok: true, value: { carrier, reference, ...(url && { url }) } };
}

// ----------------------------------------------------------------------------
// The booking agent's item choice
// ----------------------------------------------------------------------------

export interface ItemRequest {
  category: Category;
  /** Guests, recipients, tickets or participants. */
  quantity: number;
  /** Target per unit (pre-GST); the agent prefers the best item at or under it. */
  perHead: number;
  /** The most per unit it may spend. */
  maxPerHead: number;
  /** Event date (tickets must be for this date when given) or needed-by date. */
  date: string;
  /** The buyer's date, for lead times. */
  today: string;
  /** Skip items with alcohol (the company prohibits it). */
  noAlcohol: boolean;
  /** Merch: the sizes the recipients need. */
  sizes?: string[];
}

export interface ItemChoice<I> {
  item: I;
  unitPrice: number;
  tier: string | null;
  why: string;
}

/**
 * Items that can fill the request, best first: within the ceiling, the
 * priciest at or under the target (the best the budget buys), then the
 * cheapest above it. Ticket items are priced at their cheapest tier with
 * enough seats left.
 */
export function chooseItems<I extends CatalogItemLike>(items: I[], req: ItemRequest): { choices: ItemChoice<I>[]; excluded: { item: I; reason: string }[] } {
  const choices: ItemChoice<I>[] = [];
  const excluded: { item: I; reason: string }[] = [];
  const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

  for (const item of items) {
    if (item.category !== req.category || item.status !== "active" || !isCategory(item.category)) continue;
    const attrs = validateAttributes(item.category, item.attributes);
    if (!attrs.ok) continue;
    const no = (reason: string) => excluded.push({ item, reason });

    if (req.quantity < item.min_quantity) { no(`needs at least ${item.min_quantity}`); continue; }
    if (item.max_quantity !== null && req.quantity > item.max_quantity) { no(`takes at most ${item.max_quantity}`); continue; }
    if (req.noAlcohol && containsAlcohol(item)) { no("contains alcohol"); continue; }
    if (req.date < addDays(req.today, Math.max(leadTimeDays(item), 1))) { no(`needs ${leadTimeDays(item)} days' notice`); continue; }

    let unitPrice = Number(item.unit_price_inr);
    let tier: string | null = null;
    if (item.category === "tickets") {
      const t = attrs.value as TicketAttributes;
      if (t.event_date !== req.date) { no(`is on ${t.event_date}`); continue; }
      const open = t.tiers.filter((x) => x.available >= req.quantity && x.price_inr <= req.maxPerHead).sort((a, b) => a.price_inr - b.price_inr);
      if (open.length === 0) { no("no tier with enough seats within the ceiling"); continue; }
      unitPrice = open[0].price_inr;
      tier = open[0].name;
    }
    if (item.category === "merch" && req.sizes?.length) {
      const have = (attrs.value as { sizes: string[] }).sizes;
      const missing = req.sizes.filter((s) => !have.includes(s));
      if (missing.length) { no(`no size ${missing.join(", ")}`); continue; }
    }
    if (unitPrice > req.maxPerHead) { no(`₹${unitPrice} each is over the ₹${req.maxPerHead} ceiling`); continue; }
    choices.push({ item, unitPrice, tier, why: `₹${unitPrice} each${tier ? ` (${tier})` : ""}${unitPrice <= req.perHead ? ", within budget" : ", above target, within ceiling"}` });
  }
  choices.sort((a, b) => {
    const aIn = a.unitPrice <= req.perHead;
    const bIn = b.unitPrice <= req.perHead;
    if (aIn !== bIn) return aIn ? -1 : 1;
    return aIn ? b.unitPrice - a.unitPrice : a.unitPrice - b.unitPrice;
  });
  return { choices, excluded };
}
