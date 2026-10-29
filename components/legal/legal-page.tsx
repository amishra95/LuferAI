import type { ReactNode } from "react";

import { SiteHeader } from "@/components/landing/hero";
import { SiteFooter } from "@/components/landing/sections";
import { LEGAL } from "@/lib/legal";

/** Linen landing chrome around a readable column of policy text. Server-rendered, no page JS. */
export function LegalPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="landing flex flex-1 flex-col">
      <SiteHeader />
      <main className="container-public flex-1 py-12 lg:py-16">
        <article
          className={[
            "mx-auto max-w-3xl text-body text-ink",
            "[&_h2]:font-display [&_h2]:text-plum [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-section [&_h2]:font-semibold",
            "[&_h3]:text-plum [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-semibold",
            "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1",
            "[&_a]:text-coral-ink [&_a]:underline [&_a]:underline-offset-2",
            "[&_table]:my-4 [&_table]:w-full [&_table]:text-meta [&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:pr-4 [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_tr]:border-sand [&_tr]:border-b",
          ].join(" ")}
        >
          <h1 className="font-display text-plum text-title font-semibold sm:text-[2rem]">{title}</h1>
          <p className="text-ink-muted mt-2 text-meta">Last updated {LEGAL.lastUpdated}</p>
          {intro ? <div className="mt-6">{intro}</div> : null}
          {children}
        </article>
      </main>
      <div className="pb-[var(--app-safe-bottom)]">
        <SiteFooter />
      </div>
    </div>
  );
}

/** A business detail, or a visible placeholder until it's filled in (lib/legal.ts). */
export function Detail({ value, label }: { value: string | null; label: string }) {
  return value ? <>{value}</> : <span className="bg-gold-soft text-gold-ink rounded px-1.5 py-0.5 text-meta">{label}: to be confirmed</span>;
}

/** Wraps the table so it scrolls sideways on phones instead of overflowing the page. */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4">{children}</div>;
}
