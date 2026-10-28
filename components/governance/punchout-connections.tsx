"use client";

import { useState } from "react";
import { Copy, Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { createPunchoutConnectionAction, updatePunchoutConnectionAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import type { PunchoutConnection, PunchoutOrder } from "@/lib/punchout/store";
import { formatDate, formatINR } from "@/lib/utils";

const ORDER_STATUS: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" }> = {
  received: { label: "Matched to cart", variant: "success" },
  needs_review: { label: "Needs review", variant: "warning" },
  fulfilled: { label: "Fulfilled", variant: "secondary" },
  rejected: { label: "Rejected", variant: "destructive" },
};

/**
 * cXML PunchOut: the company's procurement systems (Coupa, SAP Ariba…) that
 * open the Lufer.ai catalogue from a requisition, and the purchase orders
 * they've sent. Admins create connections; the shared secret shows once.
 */
export function PunchoutConnections({
  companyId,
  connections,
  orders,
  endpoints,
  canManage,
  unavailable,
}: {
  companyId: string | null;
  connections: PunchoutConnection[];
  orders: PunchoutOrder[];
  endpoints: { setup: string; order: string };
  canManage: boolean;
  unavailable: string | null;
}) {
  const create = useAction<{ sharedSecret: string; senderIdentity: string }>();
  const update = useAction<{ ok: true }>();
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ sharedSecret: string; senderIdentity: string } | null>(null);

  const add = async (form: FormData) => {
    const outcome = await create.run(
      () => createPunchoutConnectionAction(companyId, { label: String(form.get("label") ?? ""), senderIdentity: String(form.get("sender_identity") ?? "") }),
      { failure: "Couldn't create the connection", success: () => ({ tone: "success", title: "Connection created. Copy the shared secret now." }) }
    );
    if (outcome?.ok) {
      setSecret(outcome.result);
      setAdding(false);
    }
  };
  const change = (id: string, c: "enable" | "disable" | "remove") =>
    update.run(() => updatePunchoutConnectionAction(companyId, { id, change: c }), {
      failure: "Couldn't update the connection",
      success: () => ({ tone: "success", title: c === "remove" ? "Connection removed" : c === "enable" ? "Connection resumed" : "Connection paused" }),
    });

  return (
    <section aria-labelledby="punchout-heading" className="mt-10">
      <SectionLabel>
        <span id="punchout-heading">Procurement punchout (cXML)</span>
      </SectionLabel>
      <div className="panel grid gap-4 p-5">
        <div className="flex gap-4">
          <ShoppingCart className="text-fg-subtle mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="text-fg-subtle grid gap-1 text-meta leading-5">
            <p>
              Employees open the Lufer.ai catalogue from a requisition in Coupa, SAP Ariba or any cXML procurement system, fill a cart, and send it back for approval. The approved purchase order
              returns here, matched to the cart. {unavailable ? `Unavailable: ${unavailable}.` : null}
            </p>
            <p>
              Setup URL <code className="text-fg">{endpoints.setup}</code> · Order URL <code className="text-fg">{endpoints.order}</code>
            </p>
          </div>
        </div>

        {secret ? (
          <div role="status" className="border-warn/50 bg-surface grid gap-2 rounded-lg border p-4 text-meta">
            <p className="text-fg font-medium">Shared secret for {secret.senderIdentity}. It won&apos;t be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="bg-surface-hover text-fg min-w-0 flex-1 truncate rounded px-2 py-1">{secret.sharedSecret}</code>
              <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(secret.sharedSecret)}>
                <Copy aria-hidden /> Copy
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        {connections.length ? (
          <ul className="divide-line divide-y">
            {connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
                <span className="min-w-0 flex-1 text-meta">
                  <span className="text-fg font-medium">{c.label}</span>
                  <span className="text-fg-subtle"> · sender </span>
                  <code className="text-fg-muted">{c.sender_identity}</code>
                  {!c.enabled ? <span className="text-warn"> · paused</span> : null}
                </span>
                {canManage ? (
                  <span className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={update.pending} onClick={() => change(c.id, c.enabled ? "disable" : "enable")}>
                      {c.enabled ? "Pause" : "Resume"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={update.pending} onClick={() => change(c.id, "remove")} aria-label={`Remove ${c.label}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-subtle text-meta">No procurement system connected.{canManage ? "" : " Ask Lufer.ai support to set up punchout."}</p>
        )}

        {canManage && !unavailable ? (
          adding ? (
            <form action={add} className="border-line grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
              <label className="grid gap-1 text-meta">
                <span className="text-fg-subtle">Name</span>
                <Input name="label" placeholder="Coupa production" required autoFocus maxLength={80} />
              </label>
              <label className="grid gap-1 text-meta">
                <span className="text-fg-subtle">Sender identity (from the buyer&apos;s system)</span>
                <Input name="sender_identity" placeholder="e.g. AN01000000123 or acme-coupa" required maxLength={200} className="font-mono" />
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={create.pending}>
                  {create.pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Create
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                <Plus aria-hidden /> Connect a procurement system
              </Button>
            </div>
          )
        ) : null}

        {orders.length ? (
          <div className="grid gap-2">
            <h3 className="label-mono">Purchase orders received</h3>
            <ul className="divide-line divide-y">
              {orders.map((o) => {
                const lines = Array.isArray(o.lines) ? (o.lines as { ok?: boolean; issue?: string }[]) : [];
                const issues = lines.filter((l) => !l.ok).map((l) => l.issue).filter(Boolean);
                const s = ORDER_STATUS[o.status] ?? { label: o.status, variant: "secondary" as const };
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 py-2 text-meta">
                    <span className="text-fg font-mono">{o.order_id}</span>
                    <span className="text-fg-subtle">
                      {formatDate(o.created_at.slice(0, 10))} · {lines.length} line{lines.length === 1 ? "" : "s"}
                      {o.total_inr != null ? ` · ${formatINR(Number(o.total_inr))}` : ""}
                    </span>
                    <Badge variant={s.variant} title={issues.join("; ") || undefined}>
                      {s.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
