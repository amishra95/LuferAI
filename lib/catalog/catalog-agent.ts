import "server-only";

import type { AgentBookingOutcome, AgentStep } from "@/lib/bookings/booking-agent";
import { CATEGORY_LABEL, unitNoun, type Category, type Recipient } from "@/lib/catalog/items";
import { chooseItems } from "@/lib/catalog/orders";
import { placeCatalogOrder } from "@/lib/catalog/place-order";
import { getCorporatePolicy, listCatalogItems } from "@/lib/data";
import { todayInIndia } from "@/lib/gst-engine";
import { clip, logAgentRun } from "@/lib/telemetry/runs";
import { tracer } from "@/lib/tracer";

/**
 * The booking agent for catalogue categories (gifting, tickets, merch, team
 * building, dining packages): picks the item the budget buys best
 * (lib/catalog/orders.ts → chooseItems), then orders it through the one
 * ordering path (placeCatalogOrder: pricing, GST, policy, PO, approvals).
 * The supplier confirms; the agent never does. Deterministic, traced and
 * logged as `booking-agent`, like the venue agent.
 */

export interface CatalogAgentInput {
  companyId: string;
  userId: string;
  category: Exclude<Category, never>;
  /** Guests, tickets or participants; for goods, the recipients decide it. */
  quantity: number;
  perHead: number;
  maxPerHead: number;
  /** Event date, or needed-by date for goods. */
  date: string;
  recipients?: Recipient[];
  costCenter: string;
  projectCode?: string | null;
  notes?: string;
}

const GOODS: ReadonlySet<Category> = new Set(["gifting", "merch"]);

export async function runCatalogAgent(input: CatalogAgentInput): Promise<AgentBookingOutcome> {
  const started = Date.now();
  const steps: AgentStep[] = [];
  const outcome = await tracer.trace(
    "agent.catalog",
    async (root) => {
      root.setAttributes({ category: input.category, quantity: input.quantity, date: input.date });
      const r = await order(input, steps);
      root.setAttribute("status", r.status);
      return { ...r, traceId: root.traceId };
    },
    { root: true }
  );
  await logAgentRun("booking-agent", {
    at: new Date().toISOString(),
    ok: outcome.status !== "failed",
    durationMs: Date.now() - started,
    source: "api",
    task: clip(`${CATEGORY_LABEL[input.category]} for ${input.quantity}${outcome.itemName ? `: ${outcome.itemName}` : ""} (${outcome.status.replace("_", " ")})`),
    steps: steps.length,
    ...(outcome.status === "failed" && { error: outcome.message }),
  });
  return outcome;
}

async function order(input: CatalogAgentInput, steps: AgentStep[]): Promise<Omit<AgentBookingOutcome, "traceId">> {
  const fail = (message: string) => ({ status: "failed" as const, message, steps });
  const goods = GOODS.has(input.category);
  const recipients = input.recipients ?? [];
  const quantity = goods ? recipients.length : input.quantity;
  if (goods && quantity === 0) return fail("Add the recipients: the agent orders one per person.");

  const { choices, excluded } = await tracer.trace("agent.choose", async (span) => {
    const [items, policy] = await Promise.all([listCatalogItems({ category: input.category }), getCorporatePolicy(input.companyId)]);
    const result = chooseItems(items, {
      category: input.category,
      quantity,
      perHead: input.perHead,
      maxPerHead: input.maxPerHead,
      date: input.date,
      today: todayInIndia(),
      noAlcohol: policy?.alcohol_policy === "prohibited",
      sizes: input.category === "merch" ? [...new Set(recipients.map((r) => r.size ?? ""))].filter(Boolean) : undefined,
    });
    span.setAttributes({ candidates: result.choices.length, excluded: result.excluded.length });
    return result;
  });
  if (choices.length === 0) {
    const why = excluded.map((e) => `${e.item.name} ${e.reason}`).join("; ");
    steps.push({ step: "choose", ok: false, detail: why || `No ${CATEGORY_LABEL[input.category].toLowerCase()} items listed` });
    return fail(`No ${CATEGORY_LABEL[input.category].toLowerCase()} item fits${why ? `: ${why}` : ""}.`);
  }
  const pick = choices[0];
  steps.push({
    step: "choose",
    ok: true,
    detail: `${pick.item.name} from ${(pick.item as { partner_name?: string }).partner_name ?? "supplier"}: ${pick.why}${choices.length > 1 ? ` (over ${choices.length - 1} other${choices.length > 2 ? "s" : ""})` : ""}`,
  });

  const placed = await tracer.trace("agent.place", () =>
    placeCatalogOrder({
      companyId: input.companyId,
      userId: input.userId,
      itemId: pick.item.id,
      order: goods ? { quantity, neededBy: input.date, recipients } : { quantity, eventDate: input.date, tier: pick.tier },
      expense: { costCenter: input.costCenter, projectCode: input.projectCode ?? null },
      notes: input.notes ?? "Ordered by the booking agent",
    })
  );
  if (placed.status !== "success" || !placed.orderId) {
    steps.push({ step: "place", ok: false, detail: placed.message });
    return fail(placed.message);
  }
  steps.push({ step: "place", ok: true, detail: placed.message });
  const total = placed.invoice?.taxable_value;
  return {
    status: placed.orderStatus === "PENDING_APPROVAL" ? "awaiting_approval" : "with_supplier",
    message:
      placed.orderStatus === "PENDING_APPROVAL"
        ? `Ordered ${quantity} ${unitNoun(input.category, quantity)} of ${pick.item.name}; waiting for sign-off from ${placed.approval!.approverName} (${placed.approval!.reason}).`
        : `Ordered ${quantity} ${unitNoun(input.category, quantity)} of ${pick.item.name}; ${placed.message.replace(/^Order sent to/, "sent to")}`,
    steps,
    orderId: placed.orderId,
    partnerId: placed.partnerId,
    itemName: pick.item.name,
    perHead: pick.unitPrice,
    ...(total !== undefined && { total }),
  };
}
