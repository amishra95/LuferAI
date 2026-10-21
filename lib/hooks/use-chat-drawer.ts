"use client";

import { createContext, useContext } from "react";

/** The company a page is showing; the drawer labels the conversation with it. */
export type ChatCompany = { id: string; name: string };

export type ChatDrawerState = {
  open: boolean;
  /** False on /chat itself, where the full-page chat is already showing. */
  available: boolean;
  /** Draft for the composer; `key` changes on every open so the same text can be re-applied. */
  draft: { text: string; key: number };
  company: ChatCompany | null;
  /** Opens the drawer, optionally putting `prompt` in the composer (never sent on its own). */
  openChatDrawer: (prompt?: string) => void;
  closeChatDrawer: () => void;
  toggleChatDrawer: () => void;
  /** Pages register the company they show (see ChatCompanyScope); null clears it. */
  setChatCompany: (company: ChatCompany | null) => void;
};

export const ChatDrawerContext = createContext<ChatDrawerState | null>(null);

/**
 * The in-page concierge drawer (components/ui/chat-drawer.tsx). Null outside
 * the dashboard or for users who can't use the workspace chat, so callers
 * fall back to linking to /chat.
 */
export function useChatDrawer(): ChatDrawerState | null {
  return useContext(ChatDrawerContext);
}
