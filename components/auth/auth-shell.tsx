import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { BillSheet } from "@/components/landing/bill-sheet";

/**
 * Sign-in and sign-up frame. From lg, the bill book's carbon cover sits beside the
 * form with the same stamped invoice as the home page; on phones the cover
 * shrinks to a band with the wordmark and the form follows on paper.
 */
export function AuthShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[1fr_1.1fr]">
      <aside className="on-plum flex items-center justify-between px-4 pt-[calc(0.75rem+var(--app-safe-top))] pb-3 lg:flex-col lg:items-start lg:justify-between lg:px-12 lg:py-12">
        <Link href="/" aria-label="Lufer home" className="rounded-md">
          <Logo size="sm" tagline={false} tone="linen" />
        </Link>
        <div className="hidden w-full max-w-md self-center lg:block">
          <BillSheet />
        </div>
        <p className="text-on-carbon-muted hidden text-meta lg:block">Your Corporate Entertainment Concierge</p>
        <Link
          href="/"
          className="text-on-carbon-muted inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta font-medium hover:text-white lg:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Link>
      </aside>

      <main className="flex flex-1 flex-col px-4 pt-8 pb-[calc(2.5rem+var(--app-safe-bottom))] lg:px-12 lg:pt-10">
        <Link href="/" className="text-fg-muted hover:text-fg hidden w-fit items-center gap-1.5 rounded-md py-1 text-meta font-medium lg:inline-flex">
          <ArrowLeft className="size-4" aria-hidden />
          Back to home
        </Link>
        <div className={`mx-auto flex w-full flex-1 flex-col gap-4 lg:justify-center ${wide ? "max-w-lg" : "max-w-sm"}`}>{children}</div>
      </main>
    </div>
  );
}
