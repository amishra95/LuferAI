"use client";

import { useState } from "react";
import { Loader2, Plus, Truck } from "lucide-react";

import { fulfilOrderAction, saveCatalogItemAction, setCatalogItemStatusAction, setPartnerGstinAction } from "../catalog-actions";
import { useAction, useOptimisticMutation } from "@/components/workspace/use-optimistic-mutation";
import { CATEGORIES, CATEGORY_LABEL, SHIPS, unitNoun, validateItemInput, type Category } from "@/lib/catalog/items";
import { isOrderStatus, ORDER_STAGE_LABEL, supplierActions, validateTracking, type OrderStatus } from "@/lib/catalog/orders";
import type { CatalogItem } from "@/lib/supabase/database.types";
import { cn, formatINR } from "@/lib/utils";

/**
 * The partner extranet's catalogue (items in any category, with their
 * HSN/SAC and GST rate) and the orders to fulfil. Item status and order moves
 * are optimistic; a refusal rolls back with the reason.
 */

const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const fmtDay = (iso: string | null) => (iso ? day.format(new Date(`${iso}T00:00:00+05:30`)) : "—");

export function PartnerCatalog({
  partnerId,
  gstin,
  items,
  canEdit,
  canStatus,
  canSetGstin,
}: {
  /** Admins act for a partner; null for partner users (the server uses theirs). */
  partnerId: string | null;
  gstin: string | null;
  items: CatalogItem[];
  canEdit: boolean;
  canStatus: boolean;
  canSetGstin: boolean;
}) {
  const { value: list, mutate } = useOptimisticMutation(items);
  const [adding, setAdding] = useState(false);

  const setStatus = (item: CatalogItem, status: "active" | "paused") =>
    mutate({
      apply: (l) => l.map((i) => (i.id === item.id ? { ...i, status } : i)),
      action: () => setCatalogItemStatusAction(partnerId, item.id, status),
      failure: `Couldn't ${status === "paused" ? "pause" : "resume"} ${item.name}`,
    });

  return (
    <div className="space-y-4">
      {!gstin && <GstinBanner partnerId={partnerId} canSet={canSetGstin} />}

      <section className="panel overflow-hidden" aria-label="Catalogue items">
        {list.length === 0 ? (
          <p className="text-fg-subtle px-5 py-6 text-[13px]">No catalogue items yet. Companies can order gifting, tickets, merch, team building and dining packages you list here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[12.5px]">
              <thead>
                <tr className="border-line border-b">
                  {["Item", "Category", "Price", "Tax", "Quantity", "Status", ""].map((h, i) => (
                    <th key={i} scope="col" className={cn("label-mono h-9 px-3 text-left font-medium first:pl-5 last:pr-5", (i === 2 || i === 4) && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className={cn("border-line border-b last:border-b-0", i.status === "paused" && "text-fg-faint")}>
                    <td className="py-2.5 pr-3 pl-5">
                      <p className="text-fg font-medium">{i.name}</p>
                      <p className="text-fg-subtle font-mono text-[11px]">{i.ref}</p>
                    </td>
                    <td className="px-3">{CATEGORY_LABEL[i.category as Category] ?? i.category}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{formatINR(Number(i.unit_price_inr))}</td>
                    <td className="px-3 font-mono text-[11.5px]">
                      {i.tax_kind} {i.tax_code} · {i.gst_rate_percent}%
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums">
                      {i.min_quantity}
                      {i.max_quantity ? `–${i.max_quantity}` : "+"}
                    </td>
                    <td className="px-3 font-mono text-[11.5px]">{i.status}</td>
                    <td className="py-2 pr-5 pl-3 text-right">
                      {canStatus && (
                        <button type="button" onClick={() => void setStatus(i, i.status === "active" ? "paused" : "active")} className="btn btn-ghost h-7 px-2.5 text-[12px]">
                          {i.status === "active" ? "Pause" : "Resume"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit &&
        (adding ? (
          // The save refreshes the page, so the new item arrives with the server data.
          <ItemForm partnerId={partnerId} onDone={() => setAdding(false)} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="btn h-8 px-3 text-[12.5px]">
            <Plus className="size-3.5" aria-hidden /> Add a catalogue item
          </button>
        ))}
    </div>
  );
}

function GstinBanner({ partnerId, canSet }: { partnerId: string | null; canSet: boolean }) {
  const save = useAction<{ gstin: string }>();
  const [value, setValue] = useState("");
  return (
    <div role="status" className="border-warn/30 bg-warn/[0.05] rounded-lg border px-4 py-3 text-[12.5px]">
      <p className="text-fg">Add your GSTIN: catalogue orders are invoiced under it, and companies can&apos;t order until it&apos;s set.</p>
      {canSet ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(() => setPartnerGstinAction(partnerId, value), { failure: "Couldn't save the GSTIN", success: (r) => ({ tone: "success", title: `GSTIN ${r.gstin} saved` }) });
          }}
          className="mt-2 flex gap-2"
        >
          <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={15} placeholder="29ABCDE1234F1Z5" className="field h-8 max-w-56 font-mono uppercase" aria-label="GSTIN" />
          <button type="submit" disabled={save.pending} className="btn btn-primary h-8 px-3 text-[12px]">
            {save.pending && <Loader2 className="size-3 animate-spin" aria-hidden />} Save
          </button>
        </form>
      ) : (
        <p className="text-fg-subtle mt-1">Ask your organisation&apos;s Owner to add it.</p>
      )}
    </div>
  );
}

/** Category-specific fields become `attributes`; the shared validator checks everything before sending. */
function ItemForm({ partnerId, onDone }: { partnerId: string | null; onDone: () => void }) {
  const [category, setCategory] = useState<Category>("gifting");
  const [error, setError] = useState<string | null>(null);
  const save = useAction<CatalogItem>();
  const goods = SHIPS[category];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (String(f.get(k) ?? "").trim() === "" ? undefined : Number(f.get(k)));
    const lead = num("lead_time_days");
    const attributes: Record<string, unknown> =
      category === "tickets"
        ? {
            event_name: f.get("event_name"),
            event_date: f.get("event_date"),
            venue: f.get("venue"),
            event_state_code: f.get("event_state_code"),
            tiers: String(f.get("tiers") ?? "")
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [name, price, available] = l.split("|").map((p) => p.trim());
                return { name, price_inr: Number(price), available: Number(available) };
              }),
          }
        : category === "merch"
          ? { sizes: String(f.get("sizes") ?? "").split(",").map((s) => s.trim()).filter(Boolean), lead_time_days: lead, customisable: f.get("customisable") === "on" }
          : category === "team_building"
            ? { duration_hours: num("duration_hours"), format: f.get("format"), lead_time_days: lead }
            : { lead_time_days: lead, contains_alcohol: f.get("contains_alcohol") === "on", ...(category === "gifting" && { personalisation: f.get("personalisation") === "on" }) };
    const raw = {
      category,
      ref: f.get("ref"),
      name: f.get("name"),
      description: f.get("description"),
      unit_price_inr: num("unit_price_inr"),
      tax_kind: goods ? "HSN" : "SAC",
      tax_code: f.get("tax_code"),
      gst_rate_percent: num("gst_rate_percent"),
      min_quantity: num("min_quantity") ?? 1,
      max_quantity: num("max_quantity") ?? null,
      attributes: Object.fromEntries(Object.entries(attributes).filter(([, v]) => v !== undefined)),
    };
    const valid = validateItemInput(raw);
    if (!valid.ok) return setError(valid.error);
    setError(null);
    const r = await save.run(() => saveCatalogItemAction(partnerId, raw), { failure: "Couldn't save the item", success: (i) => ({ tone: "success", title: `Listed ${i.name}` }) });
    if (r?.ok) onDone();
  }

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="grid gap-1">
      <span className="text-fg-subtle">{label}</span>
      <input name={name} className={cn("field h-8", props.type === "number" && "font-mono")} {...props} />
    </label>
  );

  return (
    <form onSubmit={submit} className="panel grid gap-2.5 px-5 py-4 text-[12px] sm:grid-cols-3">
      <h3 className="label-mono sm:col-span-3">New catalogue item</h3>
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
      {field("ref", "Ref", { required: true, maxLength: 32, placeholder: "HAMPER-01" })}
      {field("name", "Name", { required: true, maxLength: 120 })}
      <label className="grid gap-1 sm:col-span-3">
        <span className="text-fg-subtle">Description</span>
        <input name="description" maxLength={1000} placeholder="Optional" className="field h-8" />
      </label>
      {field("unit_price_inr", category === "tickets" ? "Base price ₹ (tiers below set the price)" : `Price per ${unitNoun(category, 1)} ₹ (pre-GST)`, { type: "number", min: 0, step: "0.01", required: true })}
      {field("tax_code", `${goods ? "HSN" : "SAC"} code`, { required: true, inputMode: "numeric", pattern: "[0-9]{4,8}" })}
      <label className="grid gap-1">
        <span className="text-fg-subtle">GST rate</span>
        <select name="gst_rate_percent" defaultValue={18} className="field h-8">
          {[0, 5, 12, 18, 28].map((r) => (
            <option key={r} value={r}>
              {r}%
            </option>
          ))}
        </select>
      </label>
      {field("min_quantity", `Minimum ${unitNoun(category, 2)}`, { type: "number", min: 1, defaultValue: 1 })}
      {field("max_quantity", "Maximum", { type: "number", min: 1, placeholder: "No limit" })}
      {category !== "tickets" && field("lead_time_days", "Notice needed (days)", { type: "number", min: 0, max: 120, placeholder: "0" })}

      {category === "tickets" && (
        <>
          {field("event_name", "Event", { required: true })}
          {field("event_date", "Event date", { type: "date", required: true })}
          {field("venue", "Venue", { required: true })}
          {field("event_state_code", "Event state code (place of supply)", { required: true, pattern: "[0-9]{2}", placeholder: "29" })}
          <label className="grid gap-1 sm:col-span-3">
            <span className="text-fg-subtle">Tiers, one per line: name | price ₹ | seats available</span>
            <textarea name="tiers" rows={3} required className="field h-auto py-2 font-mono text-[11.5px]" placeholder={"General | 1500 | 200\nPavilion | 4500 | 40"} />
          </label>
        </>
      )}
      {category === "merch" && (
        <>
          {field("sizes", "Sizes (comma-separated)", { required: true, placeholder: "S, M, L, XL" })}
          <label className="text-fg-muted flex items-center gap-1.5 self-end pb-2">
            <input type="checkbox" name="customisable" className="accent-fg size-3.5" /> logo / customisable
          </label>
        </>
      )}
      {category === "team_building" && (
        <>
          {field("duration_hours", "Duration (hours)", { type: "number", min: 0.5, step: 0.5, required: true })}
          <label className="grid gap-1">
            <span className="text-fg-subtle">Format</span>
            <select name="format" className="field h-8">
              <option value="onsite">Onsite</option>
              <option value="offsite">Offsite</option>
              <option value="virtual">Virtual</option>
            </select>
          </label>
        </>
      )}
      {(category === "gifting" || category === "dining") && (
        <label className="text-fg-muted flex items-center gap-1.5 self-end pb-2">
          <input type="checkbox" name="contains_alcohol" className="accent-fg size-3.5" /> contains alcohol
        </label>
      )}
      {category === "gifting" && (
        <label className="text-fg-muted flex items-center gap-1.5 self-end pb-2">
          <input type="checkbox" name="personalisation" className="accent-fg size-3.5" /> personalisation
        </label>
      )}

      {error && (
        <p role="alert" className="text-rose text-[12px] sm:col-span-3">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 sm:col-span-3">
        <button type="button" onClick={onDone} className="btn btn-ghost h-8 px-3">
          Cancel
        </button>
        <button type="submit" disabled={save.pending} className="btn btn-primary h-8 px-3">
          {save.pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />} List item
        </button>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------------------
// Orders to fulfil
// ----------------------------------------------------------------------------

export interface FulfilOrder {
  id: string;
  company_name: string;
  item_name: string;
  category: string;
  quantity: number;
  total_amount_inr: number;
  status: string;
  event_date: string | null;
  needed_by: string | null;
  selections: Record<string, unknown>;
  recipients: { name: string; address: string; email?: string; phone?: string; size?: string }[];
  tracking: { carrier?: string; reference?: string; url?: string } | null;
}

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = { CONFIRMED: "Confirm", SHIPPED: "Mark shipped", DELIVERED: "Mark delivered", CANCELLED: "Decline" };

export function PartnerOrders({ partnerId, orders, canFulfil }: { partnerId: string | null; orders: FulfilOrder[]; canFulfil: boolean }) {
  const { value: list, mutate } = useOptimisticMutation(orders);

  const move = (o: FulfilOrder, next: OrderStatus, tracking?: FulfilOrder["tracking"]) =>
    mutate({
      apply: (l) => l.map((x) => (x.id === o.id ? { ...x, status: next, ...(tracking && { tracking }) } : x)),
      action: () => fulfilOrderAction(partnerId, o.id, next, tracking ?? undefined),
      failure: `Couldn't update ${o.company_name}'s order`,
      success: () => ({ tone: "success", title: `${o.item_name}: ${ORDER_STAGE_LABEL[next].toLowerCase()}` }),
    });

  if (list.length === 0) return <div className="panel text-fg-subtle px-5 py-6 text-[13px]">No orders yet.</div>;
  return (
    <ul className="space-y-3">
      {list.map((o) => (
        <OrderCard key={o.id} order={o} canFulfil={canFulfil} onMove={(next, tracking) => void move(o, next, tracking)} />
      ))}
    </ul>
  );
}

function OrderCard({ order: o, canFulfil, onMove }: { order: FulfilOrder; canFulfil: boolean; onMove: (next: OrderStatus, tracking?: FulfilOrder["tracking"]) => void }) {
  const [shipping, setShipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = isOrderStatus(o.status) ? o.status : null;
  const actions = status && canFulfil ? supplierActions(o.category as Category, status) : [];
  return (
    <li className="panel px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span className="text-fg font-medium">{o.company_name.replace(/ Private Limited$/, "")}</span>
        <span className="text-fg-muted">
          {o.quantity} × {o.item_name}
        </span>
        <span className="text-fg-subtle font-mono text-[11.5px] tabular-nums">{formatINR(o.total_amount_inr)} pre-GST</span>
        <span className="pill ml-auto">{status ? ORDER_STAGE_LABEL[status] : o.status}</span>
      </div>
      <p className="text-fg-faint mt-0.5 font-mono text-[11px]">
        {o.event_date ? `event ${fmtDay(o.event_date)}` : `needed by ${fmtDay(o.needed_by)}`}
        {typeof o.selections.tier === "string" && ` · ${o.selections.tier}`}
        {o.selections.sizes ? ` · sizes ${Object.entries(o.selections.sizes as Record<string, number>).map(([s, n]) => `${s}×${n}`).join(" ")}` : ""}
        {o.tracking?.reference && ` · ${o.tracking.carrier} ${o.tracking.reference}`}
      </p>
      {o.recipients.length > 0 && (
        <details className="mt-2">
          <summary className="text-fg-subtle cursor-pointer text-[12px]">
            {o.recipients.length} recipient{o.recipients.length === 1 ? "" : "s"}
          </summary>
          <ul className="text-fg-muted mt-1.5 space-y-1 font-mono text-[11.5px]">
            {o.recipients.map((r, i) => (
              <li key={i}>
                {r.name}
                {r.size ? ` (${r.size})` : ""} · {r.address}
                {r.phone ? ` · ${r.phone}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {actions.length > 0 && !shipping && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => (a === "SHIPPED" ? setShipping(true) : onMove(a))}
              className={cn("btn h-7 px-2.5 text-[12px]", a === "CANCELLED" ? "btn-ghost" : a === actions[0] && "btn-primary")}
            >
              {a === "SHIPPED" && <Truck className="size-3" aria-hidden />}
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      )}
      {shipping && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const t = validateTracking({ carrier: f.get("carrier"), reference: f.get("reference"), url: f.get("url") });
            if (!t.ok) return setError(t.error);
            setError(null);
            setShipping(false);
            onMove("SHIPPED", t.value);
          }}
          className="mt-2.5 grid gap-2 text-[12px] sm:grid-cols-[1fr_1fr_2fr_auto]"
        >
          <input name="carrier" required placeholder="Carrier" aria-label="Carrier" className="field h-8" />
          <input name="reference" required placeholder="Tracking number" aria-label="Tracking number" className="field h-8 font-mono" />
          <input name="url" type="url" placeholder="https://… (optional)" aria-label="Tracking link" className="field h-8" />
          <div className="flex gap-1.5">
            <button type="submit" className="btn btn-primary h-8 px-3">
              Ship
            </button>
            <button type="button" onClick={() => setShipping(false)} className="btn btn-ghost h-8 px-2">
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="text-rose sm:col-span-4">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
