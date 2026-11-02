"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Minus, Plus, Send } from "lucide-react";

import { returnCartAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatINR } from "@/lib/utils";

export interface ShopItem {
  id: string;
  name: string;
  supplier: string;
  category: string;
  description: string | null;
  /** Pre-GST, INR. */
  unitPrice: number;
  gstRate: number;
  min: number;
  max: number | null;
}

/**
 * Catalogue with quantities and a running cart. "Send to procurement" saves
 * the cart, then posts the PunchOutOrderMessage to the buyer's system in this
 * window (BrowserFormPost), which takes the employee back to their requisition.
 */
export function PunchoutShop({ token, items, initial, readOnly, returned }: { token: string; items: ShopItem[]; initial: Record<string, number>; readOnly: boolean; returned: boolean }) {
  const [qty, setQty] = useState<Record<string, number>>(initial);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const [post, setPost] = useState<{ url: string; cxml: string } | null>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lines = Object.entries(qty).filter(([id, n]) => n > 0 && byId.has(id));
  const subtotal = lines.reduce((s, [id, n]) => s + n * byId.get(id)!.unitPrice, 0);
  const gst = lines.reduce((s, [id, n]) => s + (n * byId.get(id)!.unitPrice * byId.get(id)!.gstRate) / 100, 0);
  const shown = items.filter((i) => !query.trim() || `${i.name} ${i.supplier} ${i.category}`.toLowerCase().includes(query.trim().toLowerCase()));

  const set = (item: ShopItem, n: number) => {
    const clamped = n <= 0 ? 0 : Math.min(Math.max(n, item.min), item.max ?? Infinity);
    setQty((q) => ({ ...q, [item.id]: clamped }));
  };

  const send = () =>
    startTransition(async () => {
      setError(null);
      const result = await returnCartAction(token, lines.map(([itemId, quantity]) => ({ itemId, quantity })), !readOnly);
      if (!result.ok) return setError(result.error);
      setPost({ url: result.formPost, cxml: result.cxml });
      // Submit after React renders the form with the payload.
      requestAnimationFrame(() => form.current?.submit());
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <section aria-label="Catalogue" className="grid gap-3">
        <Input type="search" placeholder="Search items or suppliers" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the catalogue" />
        {shown.length === 0 ? <p className="text-fg-subtle text-body">No items match.</p> : null}
        <ul className="grid gap-2">
          {shown.map((i) => {
            const n = qty[i.id] ?? 0;
            return (
              <li key={i.id} className={cn("panel flex flex-wrap items-center gap-4 p-4", n > 0 && "border-fg/40")}>
                <div className="min-w-0 flex-1">
                  <p className="text-fg text-body font-medium">{i.name}</p>
                  <p className="text-fg-subtle text-caption">
                    {i.category} · {i.supplier} · GST {i.gstRate}%{i.min > 1 ? ` · min ${i.min}` : ""}
                  </p>
                  {i.description ? <p className="text-fg-muted mt-1 line-clamp-2 text-meta">{i.description}</p> : null}
                </div>
                <span className="figure text-fg text-meta">{formatINR(i.unitPrice)}</span>
                {readOnly ? (
                  n > 0 ? <span className="figure text-fg-muted text-meta">× {n}</span> : null
                ) : (
                  <div className="flex items-center gap-1">
                    <Button type="button" size="icon" variant="ghost" aria-label={`Fewer ${i.name}`} disabled={n === 0} onClick={() => set(i, n - 1 < i.min ? 0 : n - 1)}>
                      <Minus aria-hidden />
                    </Button>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={i.max ?? undefined}
                      value={n || ""}
                      placeholder="0"
                      onChange={(e) => set(i, Number(e.target.value) || 0)}
                      className="w-16 text-center"
                      aria-label={`Quantity of ${i.name}`}
                    />
                    <Button type="button" size="icon" variant="ghost" aria-label={`More ${i.name}`} disabled={i.max !== null && n >= i.max} onClick={() => set(i, Math.max(n + 1, i.min))}>
                      <Plus aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="panel sticky top-4 grid gap-3 p-5" aria-label="Cart">
        <h2 className="text-fg text-body font-medium">Cart</h2>
        {lines.length === 0 ? (
          <p className="text-fg-subtle text-meta">Nothing yet.</p>
        ) : (
          <ul className="grid gap-1.5 text-meta">
            {lines.map(([id, n]) => (
              <li key={id} className="flex justify-between gap-3">
                <span className="text-fg-muted min-w-0 truncate">
                  {n} × {byId.get(id)!.name}
                </span>
                <span className="figure text-fg shrink-0">{formatINR(n * byId.get(id)!.unitPrice)}</span>
              </li>
            ))}
          </ul>
        )}
        <dl className="border-line grid gap-1 border-t pt-3 text-meta">
          <div className="flex justify-between">
            <dt className="text-fg-subtle">Subtotal</dt>
            <dd className="figure text-fg">{formatINR(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-fg-subtle">GST (estimate)</dt>
            <dd className="figure text-fg-muted">{formatINR(Math.round(gst * 100) / 100)}</dd>
          </div>
        </dl>
        <Button type="button" size="lg" onClick={send} disabled={pending || (!readOnly && lines.length === 0)}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          {readOnly ? "Back to procurement" : "Send to procurement"}
        </Button>
        {returned ? <p className="text-fg-subtle text-caption">This cart was already sent. To change it, edit the requisition in your procurement system.</p> : null}
        {error ? (
          <p role="alert" className="text-rose text-meta">
            {error}
          </p>
        ) : null}
      </aside>

      {post ? (
        <form ref={form} method="post" action={post.url} className="hidden" aria-hidden>
          <input type="hidden" name="cxml-urlencoded" value={post.cxml} />
        </form>
      ) : null}
    </div>
  );
}
