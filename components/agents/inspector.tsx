"use client";

import { useState } from "react";
import { ScrollText, ShieldCheck, X } from "lucide-react";

import { Drawer } from "@/components/dashboard/drawer";
import type { PromptTemplate } from "@/lib/ai/prompts";

export type GuardrailSpec = {
  tool: string;
  agent: string;
  surface: string;
  gate: string;
  rules: readonly (readonly [string, string])[];
};

type Panel = "prompts" | "guardrails" | null;

/** Read-only drawers for the prompt templates and guardrail thresholds the agents run with. */
export function Inspector({
  prompts,
  guardrails,
  pricing,
  model,
}: {
  prompts: PromptTemplate[];
  guardrails: readonly GuardrailSpec[];
  pricing: [string, string][];
  model: string | null;
}) {
  const [open, setOpen] = useState<Panel>(null);
  const close = () => setOpen(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn h-8 px-3 text-[12.5px]" onClick={() => setOpen("prompts")}>
          <ScrollText className="size-3.5" aria-hidden />
          Prompt templates
          <span className="text-fg-faint font-mono text-[10.5px] tabular-nums">{prompts.length}</span>
        </button>
        <button type="button" className="btn h-8 px-3 text-[12.5px]" onClick={() => setOpen("guardrails")}>
          <ShieldCheck className="size-3.5" aria-hidden />
          Guardrails &amp; thresholds
          <span className="text-fg-faint font-mono text-[10.5px] tabular-nums">{guardrails.length}</span>
        </button>
      </div>

      <Drawer open={open === "prompts"} onClose={close} side="right" label="Prompt templates" panelClassName="w-[min(40rem,100vw)] bg-elevated">
        <DrawerHeader title="Prompt templates" subtitle={`Live system prompts${model ? ` · ${model}` : ""} · read-only`} onClose={close} />
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-fg-subtle text-[12.5px] leading-5">
            Rendered from <code className="font-mono text-[11.5px]">lib/ai/prompts.ts</code>, the same source the routes send. Values in{" "}
            <code className="font-mono text-[11.5px]">{"{braces}"}</code> are filled per request.
          </p>
          {prompts.map((p, i) => (
            <details key={p.agent} open={i === 0} className="border-line group rounded-lg border">
              <summary className="hover:bg-surface-hover flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3">
                <span className="min-w-0">
                  <span className="text-fg block text-[13px] font-medium">{p.name}</span>
                  <span className="text-fg-subtle block truncate font-mono text-[11px]">
                    {p.surface} · {p.route}
                  </span>
                </span>
                <span className="label-mono shrink-0 group-open:hidden">show</span>
                <span className="label-mono hidden shrink-0 group-open:inline">hide</span>
              </summary>
              <div className="border-line space-y-3 border-t px-4 py-3">
                <pre className="bg-canvas text-fg-muted max-h-80 overflow-auto rounded-md p-3 font-mono text-[11.5px] leading-5 whitespace-pre-wrap">{p.text}</pre>
                {p.variants?.map((v) => (
                  <div key={v.when}>
                    <p className="label-mono mb-1">variant · {v.when}</p>
                    <pre className="bg-canvas text-fg-muted rounded-md p-3 font-mono text-[11.5px] leading-5 whitespace-pre-wrap">{v.text}</pre>
                  </div>
                ))}
                {p.approvals && (
                  <div>
                    <p className="label-mono mb-1.5">needs host approval</p>
                    <ul className="space-y-1">
                      {Object.entries(p.approvals).map(([tool, reason]) => (
                        <li key={tool} className="flex flex-wrap gap-x-2 text-[12.5px]">
                          <span className="text-fg font-mono text-[11.5px]">{tool}</span>
                          <span className="text-fg-subtle">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      </Drawer>

      <Drawer open={open === "guardrails"} onClose={close} side="right" label="Guardrails and thresholds" panelClassName="w-[min(36rem,100vw)] bg-elevated">
        <DrawerHeader title="Guardrails & thresholds" subtitle="Enforced server-side on every AI write · read-only" onClose={close} />
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <p className="text-fg-subtle text-[12.5px] leading-5">
            Limits come from <code className="font-mono text-[11.5px]">GUARDRAIL_LIMITS</code> in{" "}
            <code className="font-mono text-[11.5px]">lib/guardrails/schemas.ts</code>. A refusal writes nothing and shows in the feed as Auto-Decline.
          </p>
          {guardrails.map((g) => (
            <section key={g.tool} className="border-line rounded-lg border">
              <header className="border-line flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
                <h3 className="text-fg font-mono text-[12.5px]">{g.tool}</h3>
                <span className="text-fg-subtle text-[12px]">
                  {g.agent} · {g.surface}
                </span>
              </header>
              <dl className="divide-line divide-y">
                <Rule label="Gate" value={g.gate} />
                {g.rules.map(([label, value]) => (
                  <Rule key={label} label={label} value={value} />
                ))}
              </dl>
            </section>
          ))}
          <section className="border-line rounded-lg border">
            <header className="border-line border-b px-4 py-2.5">
              <h3 className="text-fg text-[12.5px] font-medium">Instant-quote pricing</h3>
              <p className="text-fg-subtle text-[12px]">Deterministic (lib/quotes, lib/rates); no model sets a price.</p>
            </header>
            <dl className="divide-line divide-y">
              {pricing.map(([label, value]) => (
                <Rule key={label} label={label} value={value} />
              ))}
            </dl>
          </section>
        </div>
      </Drawer>
    </>
  );
}

function DrawerHeader({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  return (
    <header className="border-line flex items-start justify-between border-b px-5 py-4">
      <div>
        <h2 className="text-fg text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="text-fg-subtle mt-0.5 text-[12px]">{subtitle}</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-icon -mr-2 size-8">
        <X className="size-4" aria-hidden />
      </button>
    </header>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-fg-subtle text-[12px]">{label}</dt>
      <dd className="text-fg-muted text-[12.5px]">{value}</dd>
    </div>
  );
}
