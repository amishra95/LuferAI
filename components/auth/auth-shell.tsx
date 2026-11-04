import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Sign-in and sign-up frame: a back link to the home page, the wordmark above a centred form. */
export function AuthShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <>
      <Link
        href="/"
        className="text-fg-muted hover:text-fg fixed top-[calc(1rem+var(--app-safe-top))] left-4 z-10 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta font-medium"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Link>
      <main
        className={`mx-auto flex w-full flex-1 flex-col justify-center gap-4 px-4 pt-[calc(2.5rem+var(--app-safe-top))] pb-[calc(2.5rem+var(--app-safe-bottom))] ${wide ? "max-w-lg" : "max-w-sm"}`}
      >
        <Link
          href="/"
          aria-label="Lufer home"
          className="text-fg mb-2 w-fit self-center rounded-md"
        >
          <span className="font-display text-[1.6rem] leading-none font-semibold tracking-tight">
            Lufer
          </span>
        </Link>
        {children}
      </main>
    </>
  );
}
