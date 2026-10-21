"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";

import { conciergeHref } from "@/lib/chat/concierge-link";
import { cn } from "@/lib/utils";

// The platform never changes while the page is open.
const noSubscribe = () => () => {};

/*
 * Floating "Ask LuferAI Concierge" pill, bottom-right on every dashboard page
 * except the chat itself. Opens /chat carrying the company being viewed
 * (?company= on the portals). ⌘J / Ctrl+J opens it from anywhere; ⌘K stays
 * the command palette.
 */
export function FloatingAiConcierge() {
  const pathname = usePathname();
  const router = useRouter();
  const company = useSearchParams().get("company");
  const href = conciergeHref({ companyId: company });
  const hidden = pathname === "/chat" || pathname.startsWith("/chat/");

  // ⌘ on Apple keyboards, Ctrl elsewhere; decided after mount so server and client markup match.
  const mod = useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl"
  );

  useEffect(() => {
    if (hidden) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        router.push(href);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, href, router]);

  if (hidden) return null;
  return (
    <Link
      href={href}
      aria-label="Ask LuferAI Concierge"
      aria-keyshortcuts="Meta+J Control+J"
      className={cn(
        "bg-plum text-white border-coral/30 hover:border-coral fixed right-4 bottom-[calc(1rem+var(--app-safe-bottom))] z-40 flex items-center gap-3 rounded-full border shadow-xl transition-all hover:scale-105",
        "size-12 justify-center sm:right-6 sm:bottom-[calc(1.5rem+var(--app-safe-bottom))] sm:size-auto sm:px-5 sm:py-3"
      )}
    >
      <Sparkles className="text-coral size-5 shrink-0 sm:size-4" aria-hidden />
      <span className="hidden text-meta font-medium sm:inline">Ask LuferAI Concierge…</span>
      <kbd className="border-plum-light text-on-plum-muted hidden rounded-tile border px-1.5 text-caption sm:inline">{mod}J</kbd>
    </Link>
  );
}
