import Link from "next/link";
import { BadgeCheck, MessageCircle, ReceiptText } from "lucide-react";

/*
 * Sign-in and sign-up frame: a plum brand panel beside the form on wide
 * screens, a compact wordmark above it on phones. Claims mirror the landing
 * page (components/landing), which cites the code behind each one.
 */

const POINTS = [
  { icon: BadgeCheck, text: "Venues checked against your policy before anyone books" },
  { icon: MessageCircle, text: "Approvals on WhatsApp or Slack, in one tap" },
  { icon: ReceiptText, text: "GST tax invoices with input tax credit tracked" },
];

function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="Lufer home" className={className}>
      <span className="font-display text-[1.6rem] leading-none font-semibold tracking-tight">
        Lufer
      </span>
    </Link>
  );
}

export function AuthShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,26rem)_1fr] xl:grid-cols-[minmax(0,30rem)_1fr]">
      <aside className="on-plum landing-dark relative hidden flex-col justify-between overflow-hidden p-10 pt-[calc(2.5rem+var(--app-safe-top))] lg:flex">
        <Wordmark className="text-linen relative w-fit rounded-md" />
        <div className="relative">
          <p className="font-display text-linen text-3xl leading-tight font-semibold tracking-tight text-balance">
            Corporate events, booked inside your rules.
          </p>
          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="text-on-plum-muted flex items-start gap-3 text-meta">
                <Icon className="text-gold mt-0.5 size-4 shrink-0" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-on-plum-muted relative text-caption">Built for Indian companies, GST and all.</p>
      </aside>

      <main
        className={`mx-auto flex w-full flex-col justify-center gap-4 px-4 pt-[calc(2.5rem+var(--app-safe-top))] pb-[calc(2.5rem+var(--app-safe-bottom))] ${wide ? "max-w-lg" : "max-w-sm"}`}
      >
        <Wordmark className="text-fg mb-2 w-fit self-center rounded-md lg:hidden" />
        {children}
      </main>
    </div>
  );
}
