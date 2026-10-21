"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";

import { useChatDrawer } from "@/lib/hooks/use-chat-drawer";
import { cn } from "@/lib/utils";

// The platform never changes while the page is open.
const noSubscribe = () => () => {};

/*
 * Floating "Ask LuferAI Concierge" pill, bottom-right on every dashboard page
 * except the chat itself. Toggles the in-page concierge drawer
 * (components/ui/chat-drawer.tsx); ⌘J / Ctrl+J does the same from anywhere.
 * ⌘K stays the command palette.
 */
export function FloatingAiConcierge() {
  const drawer = useChatDrawer();
  const toggle = drawer?.available ? drawer.toggleChatDrawer : undefined;

  // ⌘ on Apple keyboards, Ctrl elsewhere; "Ctrl" on the server so the markup matches.
  const mod = useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl"
  );

  useEffect(() => {
    if (!toggle) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // No drawer here (no chat access, or on /chat), or the drawer is already showing.
  if (!drawer?.available || drawer.open) return null;
  return (
    <button
      type="button"
      onClick={drawer.toggleChatDrawer}
      aria-label="Ask LuferAI Concierge"
      aria-haspopup="dialog"
      aria-expanded={false}
      aria-keyshortcuts="Meta+J Control+J"
      className={cn(
        "bg-plum text-white border-coral/30 hover:border-coral fixed right-4 bottom-[calc(1rem+var(--app-safe-bottom))] z-40 flex cursor-pointer items-center gap-3 rounded-full border shadow-xl transition-all hover:scale-105",
        "size-12 justify-center sm:right-6 sm:bottom-[calc(1.5rem+var(--app-safe-bottom))] sm:size-auto sm:px-5 sm:py-3"
      )}
    >
      <Sparkles className="text-coral size-5 shrink-0 sm:size-4" aria-hidden />
      <span className="hidden text-meta font-medium sm:inline">Ask LuferAI Concierge…</span>
      <kbd className="border-plum-light text-on-plum-muted hidden rounded-tile border px-1.5 text-caption sm:inline">{mod}J</kbd>
    </button>
  );
}
