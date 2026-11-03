import Link from "next/link";

/** Sign-in and sign-up frame: the wordmark above a centred form. Nothing else. */
export function AuthShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col justify-center gap-4 px-4 pt-[calc(2.5rem+var(--app-safe-top))] pb-[calc(2.5rem+var(--app-safe-bottom))] ${wide ? "max-w-lg" : "max-w-sm"}`}
    >
      <Link href="/" aria-label="Lufer home" className="text-fg mb-2 w-fit self-center rounded-md">
        <span className="font-display text-[1.6rem] leading-none font-semibold tracking-tight">Lufer</span>
      </Link>
      {children}
    </main>
  );
}
