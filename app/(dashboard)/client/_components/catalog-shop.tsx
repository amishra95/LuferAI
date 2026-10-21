"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Check, Loader2, Receipt, ShoppingBag, Store, X } from "lucide-react";

import { dispatchBookingAgent } from "../actions";
import { cancelCatalogOrderAction, placeCatalogOrderAction, syncOrderExpenseAction, type CatalogOrderRequest } from "../catalog-actions";
import { useAction, useOptimisticMutation } from "@/components/workspace/use-optimistic-mutation";
import type { AgentBookingOutcome } from "@/lib/bookings/booking-agent";
import { CATEGORIES, CATEGORY_LABEL, parseRecipientLines, priceOrder, SHIPS, unitNoun, validateAttributes, type Category, type OrderInput, type TicketAttributes } from "@/lib/catalog/items";
import { ORDER_STAGE_LABEL, isOrderStatus } from "@/lib/catalog/orders";
import { STAGE_LABEL, type ReconciliationStage } from "@/lib/marketplace/settlement";
import { PayDepositButton } from "./pay-deposit-button";
import { DisabledAction } from "@/components/portal/disabled-action";
import { EmptyState } from "@/components/portal/empty-state";
import { cn, formatINR } from "@/lib/utils";

/**
 * The client portal's Catalogue tab: gifting, tickets, merch, team building and
 * dining packages from partner suppliers. Order an item directly or let the
 * booking agent pick one; both go through the company's spend policy, PO and
 * approvals. Orders show here with the supplier's progress and tracking.
 * Placing and cancelling are optimistic; a refusal rolls back with the reason.
 */

export interface ShopItem {
  id: string;
  category: string;
  name: string;
  description: string | null;
  partner_name: string;
  unit_price_inr: number;
  tax_kind: string;
  tax_code: string;
  gst_rate_percent: number;
  min_quantity: number;
  max_quantity: number | null;
  attributes: unknown;
  status: string;
  partner_id: string;
}

export interface ShopOrder {
  id: string;
  item_name: string;
  partner_name: string;
  category: string;
  quantity: number;
  total_amount_inr: number;
  invoice_total: number | null;
  status: string;
  event_date: string | null;
  needed_by: string | null;
  tracking: { carrier?: string; reference?: string; url?: string } | null;
  created_at: string;
  /** Optimistic placeholder while the server places it. */
  pending?: boolean;
  /** Payment and PO reconciliation (lib/marketplace); absent outside Supabase. */
  payment?: { stage: ReconciliationStage; issues: string[] };
}

/** Orders the buyer can pay: with the supplier and not yet cancelled or settled. */
const PAYABLE = new Set(["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED"]);

const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const fmtDay = (iso: string | null) => (iso ? day.format(new Date(`${iso}T00:00:00+05:30`)) : "—");

export function CatalogShop({
  items,
  orders,
  canOrder,
  canSync,
  canPay = false,
  today,
  marketplaceHref = null,
  readOnlyReason = "You can't order from this account.",
}: {
  items: ShopItem[];
  orders: ShopOrder[];
  canOrder: boolean;
  canSync: boolean;
  canPay?: boolean;
  today: string;
  /** Where "Browse marketplace" goes from an empty catalogue (the venue marketplace this viewer can use), or null to omit it. */
  marketplaceHref?: string | null;
  /** Shown on the disabled Order buttons when canOrder is false. */
  readOnlyReason?: string;
}) {
  const [category, setCategory] = useState<Category | "all">("all");
  const [ordering, setOrdering] = useState<string | null>(null);
  const { value: list, mutate } = useOptimisticMutation(orders);
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).length])), [items]);
  // Only categories with something listed get a filter; an empty one would lead nowhere.
  const listed = CATEGORIES.filter((c) => counts[c] > 0);
  // A category that emptied since it was picked falls back to all.
  const active = category !== "all" && listed.includes(category) ? category : "all";
  const shown = items.filter((i) => active === "all" || i.category === active);

  const place = (item: ShopItem, request: CatalogOrderRequest, quantity: number, total: number) => {
    const tempId = `pending-${crypto.randomUUID()}`;
    return mutate({
      apply: (l) => [
        {
          id: tempId,
          item_name: item.name,
          partner_name: item.partner_name,
          category: item.category,
          quantity,
          total_amount_inr: total,
          invoice_total: null,
          status: "PLACED",
          event_date: request.order.eventDate ?? null,
          needed_by: request.order.neededBy ?? null,
          tracking: null,
          created_at: new Date().toISOString(),
          pending: true,
        },
        ...l,
      ],
      action: () => placeCatalogOrderAction(request),
      // The refresh brings the real row; until then show the placeholder with its real status.
      commit: (l, placed) => l.map((o) => (o.id === tempId ? { ...o, id: placed.orderId, status: placed.status, pending: false } : o)),
      failure: `Couldn't order ${item.name}`,
      success: (placed) => ({ tone: placed.status === "PENDING_APPROVAL" ? "info" : "success", title: placed.status === "PENDING_APPROVAL" ? "Sent for sign-off" : "Order placed", description: placed.message }),
    });
  };

  const cancel = (o: ShopOrder) =>
    mutate({
      apply: (l) => l.map((x) => (x.id === o.id ? { ...x, status: "CANCELLED" } : x)),
      action: () => cancelCatalogOrderAction(o.id),
      failure: `Couldn't cancel ${o.item_name}`,
      success: () => ({ tone: "success", title: "Order cancelled", description: "Its PO allocation was released." }),
    });

  const browse = marketplaceHref ? (
    <Link href={marketplaceHref} className="btn btn-primary h-8 px-3 text-meta">
      <Store className="size-3.5" aria-hidden /> Browse marketplace <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  ) : null;
  const emptyCatalogue = (
    <EmptyState
      icon={ShoppingBag}
      title={list.length ? "Nothing listed right now" : "No catalogue items or orders yet"}
      description={
        <>
          Partners haven&apos;t listed gifting, tickets, merch, team activities or dining here yet.
          {list.length ? "" : canOrder ? " Your orders will appear here once you place one." : " Orders placed by your team's Organizers will appear here."}
          {marketplaceHref ? " Meanwhile, you can book a venue from the marketplace." : ""}
        </>
      }
      action={browse}
    />
  );

  // Nothing listed and nothing ordered: one card, not an empty list above an empty list.
  if (items.length === 0 && list.length === 0) return emptyCatalogue;

  return (
    <div className="space-y-6">
      {listed.length > 0 && (
        <nav className="flex flex-wrap gap-1.5" aria-label="Categories">
          {(["all", ...listed] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={active === c}
              className={cn("border-line h-7 rounded-md border px-2.5 text-meta", active === c ? "bg-surface-raised text-fg" : "text-fg-subtle hover:text-fg")}
            >
              {c === "all" ? "All" : CATEGORY_LABEL[c]}
              {c !== "all" && <span className="text-fg-faint ml-1.5 font-mono text-caption">{counts[c]}</span>}
            </button>
          ))}
        </nav>
      )}

      {items.length === 0 ? (
        emptyCatalogue
      ) : (
        <section className="panel overflow-hidden" aria-label="Catalogue">
          <ul className="divide-line divide-y">
            {shown.map((item) => (
              <li key={item.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-fg text-body font-medium">{item.name}</p>
                    <p className="text-fg-subtle mt-0.5 text-meta">
                      {item.partner_name} · {CATEGORY_LABEL[item.category as Category] ?? item.category} · {describe(item)}
                    </p>
                  </div>
                  <p className="text-fg shrink-0 font-mono text-meta tabular-nums">
                    {formatINR(item.unit_price_inr)}
                    <span className="text-fg-subtle"> /{unitNoun(item.category as Category, 1)} · GST {item.gst_rate_percent}%</span>
                  </p>
                  {canOrder ? (
                    <button type="button" onClick={() => setOrdering(ordering === item.id ? null : item.id)} className="btn h-7 px-2.5 text-caption">
                      <ShoppingBag className="size-3" aria-hidden /> {ordering === item.id ? "Close" : "Order"}
                    </button>
                  ) : (
                    <DisabledAction reason={readOnlyReason} className="h-7 px-2.5 text-caption">
                      <ShoppingBag className="size-3" aria-hidden /> Order
                    </DisabledAction>
                  )}
                </div>
                {ordering === item.id && (
                  <OrderForm
                    item={item}
                    today={today}
                    onPlace={async (request, quantity, total) => {
                      const outcome = await place(item, request, quantity, total);
                      if (outcome.ok) setOrdering(null);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canOrder && items.length > 0 && <AgentPick today={today} />}

      <section className="panel overflow-hidden" aria-label="Your orders">
        <h3 className="label-mono border-line border-b px-5 py-3">Orders</h3>
        {list.length === 0 ? (
          <EmptyState compact className="m-4" icon={ShoppingBag} title="No catalogue orders yet" description={canOrder ? "Order gifts, tickets, merch or team activities above, or ask the agent to pick one." : "Orders placed by your team's Organizers appear here."} />
        ) : (
          <ul className="divide-line divide-y">
            {list.map((o) => (
              <OrderRow key={o.id} order={o} canOrder={canOrder} canSync={canSync} canPay={canPay} onCancel={() => void cancel(o)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One-line summary of an item's category attributes. */
function describe(item: ShopItem): string {
  const a = (item.attributes ?? {}) as Record<string, unknown>;
  const qty = `${item.min_quantity}${item.max_quantity ? `–${item.max_quantity}` : "+"} ${unitNoun(item.category as Category, 2)}`;
  switch (item.category) {
    case "tickets":
      return `${fmtDay(String(a.event_date ?? ""))} · ${a.venue ?? ""}`;
    case "merch":
      return `${qty} · sizes ${(a.sizes as string[] | undefined)?.join(", ") ?? "—"}`;
    case "team_building":
      return `${qty} · ${a.duration_hours}h ${a.format}`;
    default:
      return `${qty}${a.lead_time_days ? ` · ${a.lead_time_days} days' notice` : ""}`;
  }
}

function OrderForm({ item, today, onPlace }: { item: ShopItem; today: string; onPlace: (r: CatalogOrderRequest, quantity: number, total: number) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const category = item.category as Category;
  const goods = SHIPS[category];
  const tickets = category === "tickets" ? (validateAttributes("tickets", item.attributes) as { ok: true; value: TicketAttributes } | { ok: false }) : null;
  const sizes = category === "merch" ? (((item.attributes ?? {}) as { sizes?: string[] }).sizes ?? []) : [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const order: OrderInput = goods
      ? { quantity: 0, neededBy: String(f.get("date") ?? ""), recipients: parseRecipientLines(String(f.get("recipients") ?? "")) }
      : { quantity: Number(f.get("quantity")), eventDate: category === "tickets" ? null : String(f.get("date") ?? ""), tier: String(f.get("tier") ?? "") || null };
    // Same rules as the server, so a mistake shows here, not as a rollback.
    const priced = priceOrder({ ...item, status: "active" }, order, today);
    if (!priced.ok) return setError(priced.error);
    const costCenter = String(f.get("cost_center") ?? "").trim();
    if (!costCenter) return setError("Enter a cost centre.");
    setError(null);
    setBusy(true);
    await onPlace({ itemId: item.id, order, costCenter, projectCode: String(f.get("project_code") ?? "") || undefined }, priced.value.quantity, priced.value.total);
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="border-line mt-3 grid gap-2 rounded-md border p-3 text-caption sm:grid-cols-2">
      {category === "tickets" && tickets?.ok ? (
        <label className="grid gap-1">
          <span className="text-fg-subtle">Tier</span>
          <select name="tier" className="field h-8">
            {tickets.value.tiers.map((t) => (
              <option key={t.name} value={t.name} disabled={t.available === 0}>
                {t.name} · {formatINR(t.price_inr)} · {t.available} left
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="grid gap-1">
          <span className="text-fg-subtle">{goods ? "Needed by" : "Event date"}</span>
          <input name="date" type="date" min={today} required className="field h-8 font-mono" />
        </label>
      )}
      {!goods && (
        <label className="grid gap-1">
          <span className="text-fg-subtle">{category === "tickets" ? "Tickets" : category === "dining" ? "Guests" : "Participants"}</span>
          <input name="quantity" type="number" min={item.min_quantity} max={item.max_quantity ?? undefined} required className="field h-8 font-mono" />
        </label>
      )}
      {goods && (
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-fg-subtle">Recipients, one per line: name | full address{sizes.length ? ` | size (${sizes.join(", ")})` : ""}</span>
          <textarea name="recipients" rows={4} required className="field h-auto py-2 font-mono text-caption leading-5" placeholder={`Asha Rao | 12 Lavelle Rd, Bengaluru 560001${sizes.length ? ` | ${sizes[0]}` : ""}`} />
          <span className="text-fg-faint">Addresses go only to {item.partner_name} for delivery.</span>
        </label>
      )}
      <label className="grid gap-1">
        <span className="text-fg-subtle">Cost centre</span>
        <input name="cost_center" required maxLength={32} className="field h-8 font-mono uppercase" />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-subtle">Project code</span>
        <input name="project_code" maxLength={32} placeholder="Optional" className="field h-8 font-mono uppercase" />
      </label>
      {error && (
        <p role="alert" className="text-rose text-caption sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy} className="btn btn-primary h-8 px-3 text-caption">
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />} Place order
        </button>
      </div>
    </form>
  );
}

function OrderRow({ order: o, canOrder, canSync, canPay, onCancel }: { order: ShopOrder; canOrder: boolean; canSync: boolean; canPay: boolean; onCancel: () => void }) {
  const sync = useAction<{ export: string; settled: boolean }>();
  const status = isOrderStatus(o.status) ? o.status : null;
  const cancellable = canOrder && !o.pending && (status === "PENDING_APPROVAL" || status === "PLACED" || status === "CONFIRMED");
  const syncable = canSync && !o.pending && (status === "CONFIRMED" || status === "SHIPPED" || status === "DELIVERED");
  const payable = canPay && canOrder && !o.pending && PAYABLE.has(o.status) && o.payment?.stage === "unpaid" && o.invoice_total !== null;
  return (
    <li className={cn("px-5 py-3", o.pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
        <span className="text-fg min-w-0 flex-1 truncate">
          {o.item_name} <span className="text-fg-subtle">· {o.partner_name}</span>
        </span>
        <span className="text-fg-subtle font-mono text-caption tabular-nums">
          {o.quantity} {unitNoun(o.category as Category, o.quantity)} · {formatINR(o.total_amount_inr)}
          {o.invoice_total ? ` (${formatINR(o.invoice_total)} incl. GST)` : ""}
        </span>
        <span className="pill">
          {o.pending ? <Loader2 className="size-2.5 animate-spin" aria-hidden /> : status === "CANCELLED" ? <X className="text-rose size-2.5" aria-hidden /> : <Check className="size-2.5" aria-hidden />}
          {o.pending ? "placing…" : status ? ORDER_STAGE_LABEL[status] : o.status}
        </span>
        {o.payment && o.payment.stage !== "unpaid" && o.payment.stage !== "closed" ? <span className="pill">{STAGE_LABEL[o.payment.stage]}</span> : null}
        {payable && <PayDepositButton orderId={o.id} label={`Pay ${formatINR(o.invoice_total!, true)}`} />}
        {syncable && (
          <button
            type="button"
            disabled={sync.pending}
            onClick={() =>
              void sync.run(() => syncOrderExpenseAction(o.id), {
                failure: "Expense sync failed",
                success: (r) => ({ tone: r.export === "failed" ? "error" : "success", title: r.settled ? "Order settled" : `Expense ${r.export}` }),
              })
            }
            className="btn h-6 px-2 text-caption"
          >
            {sync.pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Receipt className="size-3" aria-hidden />}
            {status === "DELIVERED" ? "Settle" : "Sync expense"}
          </button>
        )}
        {cancellable && (
          <button type="button" onClick={onCancel} className="btn btn-ghost h-6 px-2 text-caption">
            Cancel
          </button>
        )}
      </div>
      {o.payment?.issues.length ? (
        <p role="status" className="text-warn mt-1 text-caption">
          {o.payment.issues.join(" ")}
        </p>
      ) : null}
      <p className="text-fg-faint mt-0.5 font-mono text-caption">
        {o.event_date ? `event ${fmtDay(o.event_date)}` : `needed by ${fmtDay(o.needed_by)}`}
        {o.tracking?.reference && (
          <>
            {" · "}
            {o.tracking.url ? (
              <a href={o.tracking.url} target="_blank" rel="noreferrer" className="hover:text-fg underline underline-offset-2">
                {o.tracking.carrier} {o.tracking.reference}
              </a>
            ) : (
              `${o.tracking.carrier} ${o.tracking.reference}`
            )}
          </>
        )}
      </p>
    </li>
  );
}

const OUTCOME: Record<AgentBookingOutcome["status"], string> = {
  confirmed: "Confirmed",
  with_venue: "Sent to venue",
  with_supplier: "Sent to supplier",
  awaiting_approval: "Awaiting approval",
  failed: "Not ordered",
};

/** Let the booking agent pick the item: category, numbers and budget; recipients for goods. */
function AgentPick({ today }: { today: string }) {
  const agent = useAction<AgentBookingOutcome>();
  const [category, setCategory] = useState<Category>("gifting");
  const [outcome, setOutcome] = useState<AgentBookingOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const goods = SHIPS[category];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const recipients = goods ? parseRecipientLines(String(f.get("recipients") ?? "")) : [];
    const perHead = Number(f.get("per_head"));
    const request = {
      category,
      recipients,
      venueId: null,
      eventDate: String(f.get("date") ?? ""),
      partySize: goods ? recipients.length : Number(f.get("quantity")),
      perHead,
      maxPerHead: Number(f.get("max_per_head") || perHead),
      alcoholIncluded: false,
      entertainment: [],
      privateDining: false,
      costCenter: String(f.get("cost_center") ?? ""),
    };
    if (!(request.partySize > 0)) return setError(goods ? "Add at least one recipient." : "Enter how many.");
    setError(null);
    const result = await agent.run(() => dispatchBookingAgent(request), {
      failure: "The booking agent couldn't start",
      success: (o) => ({ tone: o.status === "failed" ? "error" : "success", title: `Booking agent: ${OUTCOME[o.status].toLowerCase()}`, description: o.message }),
    });
    if (result?.ok) setOutcome(result.result);
  }

  return (
    <section className="panel p-5" aria-label="Let the agent pick">
      <h3 className="label-mono mb-2.5 flex items-center gap-1.5">
        <Bot className="size-3.5" aria-hidden /> Let the agent pick
      </h3>
      <form onSubmit={submit} className="grid gap-2 text-caption sm:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-fg-subtle">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="field h-8">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-fg-subtle">{goods ? "Needed by" : "Event date"}</span>
          <input name="date" type="date" min={today} required className="field h-8 font-mono" />
        </label>
        {!goods && (
          <label className="grid gap-1">
            <span className="text-fg-subtle">How many</span>
            <input name="quantity" type="number" min={1} required className="field h-8 font-mono" />
          </label>
        )}
        <label className="grid gap-1">
          <span className="text-fg-subtle">Budget each ₹</span>
          <input name="per_head" type="number" min={1} required className="field h-8 font-mono" />
        </label>
        <label className="grid gap-1">
          <span className="text-fg-subtle">Up to ₹</span>
          <input name="max_per_head" type="number" min={1} placeholder="same" className="field h-8 font-mono" />
        </label>
        <label className="grid gap-1">
          <span className="text-fg-subtle">Cost centre</span>
          <input name="cost_center" required maxLength={32} className="field h-8 font-mono uppercase" />
        </label>
        {goods && (
          <label className="grid gap-1 sm:col-span-3">
            <span className="text-fg-subtle">Recipients, one per line: name | full address{category === "merch" ? " | size" : ""}</span>
            <textarea name="recipients" rows={3} required className="field h-auto py-2 font-mono text-caption leading-5" />
          </label>
        )}
        {error && (
          <p role="alert" className="text-rose text-caption sm:col-span-3">
            {error}
          </p>
        )}
        <div className="sm:col-span-3">
          <button type="submit" disabled={agent.pending} className="btn btn-primary h-8 px-3 text-caption">
            {agent.pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Bot className="size-3.5" aria-hidden />} Dispatch booking agent
          </button>
        </div>
      </form>
      {outcome && (
        <div className="border-line mt-3 rounded-md border px-3 py-2" aria-live="polite">
          <p className="text-fg text-meta">
            {OUTCOME[outcome.status]}: {outcome.message}
          </p>
          <ol className="text-fg-subtle mt-1 space-y-0.5 font-mono text-caption">
            {outcome.steps.map((s, i) => (
              <li key={i} className={cn(!s.ok && "text-rose")}>
                {s.ok ? "✓" : "✗"} {s.step}: {s.detail}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
