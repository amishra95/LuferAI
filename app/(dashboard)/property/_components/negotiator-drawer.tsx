"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";

import { saveGuardrailsAction, type HostFormState } from "../actions";
import { ResponsiveSheetContent } from "@/components/portal/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { MAX_DISCOUNT_CAP, type NegotiationRules } from "@/lib/rfp/guardrails";
import { cn } from "@/lib/utils";
import { createNegotiatorChat, NegotiatorPanel } from "./negotiator-panel";

type Tab = "guardrails" | "chat";

/**
 * The AI negotiator as a drawer: docked right on desktop, a bottom sheet on phones.
 * Two tabs: the host's guardrails (floor, maximum discount, auto-counter rules,
 * lib/rfp/guardrails.ts) and the chat that proposes term changes within them.
 * The chat lives here (not in the sheet, which unmounts when closed), so the
 * conversation survives closing and reopening the drawer.
 */
export function NegotiatorDrawer({ venueId, venueName, rules, rulesReady }: { venueId: string; venueName: string; rules: NegotiationRules; rulesReady: boolean }) {
  const router = useRouter();
  // Approved changes alter the terms shown on the page.
  const [chat] = useState(() => createNegotiatorChat(venueId, () => router.refresh()));
  const [tab, setTab] = useState<Tab>("guardrails");
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button>
          <Sparkles aria-hidden /> AI negotiator
        </Button>
      </SheetTrigger>
      <ResponsiveSheetContent wide className="h-dvh max-md:h-[88dvh]">
        <SheetHeader className="border-b border-line/60 px-5 pt-5 pb-3 pr-14">
          <SheetTitle className="flex items-center gap-2 text-fg">
            <Sparkles className="size-4 text-sage" aria-hidden /> AI negotiator
          </SheetTitle>
          <SheetDescription>Set {venueName}&apos;s guardrails, then let the AI tune minimum spend and menu packages within them.</SheetDescription>
          <div role="tablist" aria-label="Negotiator" className="mt-2 flex gap-1">
            {(
              [
                ["guardrails", "Guardrails", ShieldCheck],
                ["chat", "Ask the AI", Sparkles],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-controls={`negotiator-${key}`}
                onClick={() => setTab(key)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]", tab === key ? "bg-surface-raised text-fg" : "text-fg-subtle hover:text-fg")}
              >
                <Icon className="size-3.5" aria-hidden /> {label}
              </button>
            ))}
          </div>
        </SheetHeader>
        {tab === "guardrails" ? (
          <div id="negotiator-guardrails" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <GuardrailsForm venueId={venueId} rules={rules} ready={rulesReady} />
          </div>
        ) : (
          <div id="negotiator-chat" role="tabpanel" className="flex min-h-0 flex-1 flex-col">
            <NegotiatorPanel chat={chat} />
          </div>
        )}
      </ResponsiveSheetContent>
    </Sheet>
  );
}

const IDLE: HostFormState = { status: "idle" };

/** Floor, maximum discount and auto-counter rules; also on /property → Pricing. */
export function GuardrailsForm({ venueId, rules, ready }: { venueId: string; rules: NegotiationRules; ready: boolean }) {
  const [state, action, pending] = useActionState(saveGuardrailsAction, IDLE);
  const [autoCounter, setAutoCounter] = useState(rules.autoCounter);
  const [autoDecline, setAutoDecline] = useState(rules.autoDeclineBelowFloor);

  if (!ready) {
    return (
      <p role="status" className="border-line text-fg-subtle rounded-lg border border-dashed px-4 py-4 text-[13px]">
        Guardrails need database migration 0025 (venue_negotiation_rules). Ask an admin to apply it; until then the AI and counters run without them.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="venue_id" value={venueId} />
      <p className="text-fg-subtle text-[13px] leading-5">
        Hard limits for every offer from this venue: your counters, direct quotes and the AI&apos;s proposals. Leave a field blank for no limit.
      </p>

      <label className="grid gap-1.5">
        <span className="label-mono">Minimum spend floor</span>
        <span className="relative">
          <span className="text-fg-subtle pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px]" aria-hidden>
            ₹
          </span>
          <Input name="min_spend_floor" inputMode="numeric" defaultValue={rules.minSpendFloor ?? ""} placeholder="40,000" className="pl-7 font-mono" />
        </span>
        <span className="text-fg-subtle text-[12px]">No counter or quote below this pre-GST total, and the AI can&apos;t set your minimum spend lower.</span>
      </label>

      <label className="grid gap-1.5">
        <span className="label-mono">Maximum discount</span>
        <span className="relative max-w-40">
          <Input name="max_discount_pct" inputMode="decimal" defaultValue={rules.maxDiscountPct ?? ""} placeholder="10" className="pr-7 font-mono" />
          <span className="text-fg-subtle pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px]" aria-hidden>
            %
          </span>
        </span>
        <span className="text-fg-subtle text-[12px]">Off your own price: the package offered, or the one in the instant quote. Up to {MAX_DISCOUNT_CAP}%.</span>
      </label>

      <fieldset className="grid gap-3">
        <legend className="label-mono mb-1">Auto-counter rules</legend>
        <label className="border-line has-checked:border-fg/40 has-checked:bg-fg/[0.04] flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3">
          <input type="checkbox" name="auto_counter" checked={autoCounter} onChange={(e) => setAutoCounter(e.target.checked)} className="accent-fg mt-0.5 size-3.5" />
          <span>
            <span className="text-fg block text-[13px]">Counter within guardrails</span>
            <span className="text-fg-subtle block text-[12.5px]">When a new RFP&apos;s budget is under your instant quote but inside your floor and discount, counter at the client&apos;s budget automatically.</span>
          </span>
        </label>
        <label className="border-line has-checked:border-fg/40 has-checked:bg-fg/[0.04] flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3">
          <input type="checkbox" name="auto_decline" checked={autoDecline} onChange={(e) => setAutoDecline(e.target.checked)} className="accent-fg mt-0.5 size-3.5" />
          <span>
            <span className="text-fg block text-[13px]">Decline below the floor</span>
            <span className="text-fg-subtle block text-[12.5px]">When a new RFP&apos;s budget can&apos;t reach your minimum spend floor, decline it automatically with a note.</span>
          </span>
        </label>
      </fieldset>

      {state.status !== "idle" && state.message ? (
        <p role={state.status === "error" ? "alert" : "status"} className={cn("text-[12.5px]", state.status === "error" ? "text-rose" : "text-sage")}>
          {state.message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />} Save guardrails
        </Button>
      </div>
    </form>
  );
}
