"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Maximize2, Sparkles, X } from "lucide-react";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { conciergeHref } from "@/lib/chat/concierge-link";
import { ChatDrawerContext, useChatDrawer, type ChatCompany, type ChatDrawerState } from "@/lib/hooks/use-chat-drawer";
import { cn } from "@/lib/utils";

/** What the drawer's chat needs from the server (the same checks /chat makes). */
export type ChatDrawerConfig = { model: string; offline: boolean; agentEnabled: boolean };

/**
 * Holds the drawer state for the dashboard and renders the drawer itself.
 * The chat mounts on first open and then stays mounted (hidden and inert when
 * closed), so a conversation survives closing the drawer and moving between pages.
 */
export function ChatDrawerProvider({ config, children }: { config: ChatDrawerConfig; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState({ text: "", key: 0 });
  const [company, setChatCompany] = useState<ChatCompany | null>(null);
  const pathname = usePathname();
  // The full-page chat is already on screen there.
  const onChatPage = pathname === "/chat" || pathname.startsWith("/chat/");

  const openChatDrawer = useCallback((prompt?: string) => {
    setMounted(true);
    setOpen(true);
    setDraft((d) => ({ text: prompt?.trim() ?? "", key: d.key + 1 }));
  }, []);
  const closeChatDrawer = useCallback(() => setOpen(false), []);
  const toggleChatDrawer = useCallback(() => {
    setMounted(true);
    setOpen((o) => !o);
  }, []);

  const value = useMemo<ChatDrawerState>(
    () => ({ open: open && !onChatPage, available: !onChatPage, draft, company, openChatDrawer, closeChatDrawer, toggleChatDrawer, setChatCompany }),
    [open, onChatPage, draft, company, openChatDrawer, closeChatDrawer, toggleChatDrawer]
  );

  return (
    <ChatDrawerContext.Provider value={value}>
      {children}
      {mounted && !onChatPage ? <ChatDrawerPanel config={config} /> : null}
    </ChatDrawerContext.Provider>
  );
}

function ChatDrawerPanel({ config }: { config: ChatDrawerConfig }) {
  const { open, draft, company, closeChatDrawer } = useChatDrawer()!;
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes (unless the inspector overlay inside is open: it closes first);
  // focus moves in on open and returns to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = panel.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !el?.querySelector('[role="dialog"]')) closeChatDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, closeChatDrawer]);

  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label="LuferAI Concierge"
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "bg-canvas border-line fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col border-l shadow-2xl outline-none transition-transform duration-300 ease-out sm:max-w-md lg:max-w-lg",
        "pt-[var(--app-safe-top)] motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      )}
    >
      <header className="border-line flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-5">
        <span aria-hidden className="bg-plum text-coral grid size-8 shrink-0 place-items-center rounded-full">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-fg text-card-title font-semibold">LuferAI Concierge</p>
          {company ? (
            <p className="text-fg-subtle flex items-center gap-1 truncate text-caption">
              <Building2 className="size-3 shrink-0" aria-hidden /> {company.name}
            </p>
          ) : null}
        </div>
        <Link
          href={conciergeHref({ companyId: company?.id })}
          onClick={closeChatDrawer}
          className="btn btn-ghost btn-icon"
          aria-label="Open full-screen chat"
          title="Open full-screen chat"
        >
          <Maximize2 className="size-4" aria-hidden />
        </Link>
        <button type="button" onClick={closeChatDrawer} className="btn btn-ghost h-8 gap-1.5 px-2" aria-label="Close concierge (Esc)">
          <kbd className="text-fg-subtle hidden text-caption sm:inline">Esc</kbd>
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <ChatWorkspace
          variant="drawer"
          model={config.model}
          offline={config.offline}
          agentEnabled={config.agentEnabled}
          defaultInspectorOpen={false}
          initialDraft={draft.text}
          draftKey={draft.key}
        />
      </div>
    </div>
  );
}

/**
 * Opens the concierge drawer, optionally with a draft prompt. Use as the child
 * of `<Button asChild>` so it takes the button's styling. Without the drawer
 * (no chat access) it falls back to a link to /chat with the same draft.
 */
export function ChatDrawerTrigger({
  prompt,
  companyId,
  onClick,
  ...props
}: Omit<React.ComponentProps<"button">, "type"> & { prompt?: string; companyId?: string }) {
  const drawer = useChatDrawer();
  if (!drawer) {
    const { className, children } = props;
    return (
      <Link href={conciergeHref({ companyId, prompt })} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={drawer.open}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        drawer.openChatDrawer(prompt);
      }}
    />
  );
}

/** Registers the company a page shows, so the drawer can label the conversation with it. */
export function ChatCompanyScope({ company }: { company: ChatCompany }) {
  const setChatCompany = useChatDrawer()?.setChatCompany;
  const { id, name } = company;
  useEffect(() => {
    if (!setChatCompany) return;
    setChatCompany({ id, name });
    return () => setChatCompany(null);
  }, [setChatCompany, id, name]);
  return null;
}
