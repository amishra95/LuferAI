import type { Metadata } from "next";

import { ConciergeChat } from "@/components/chat/concierge-chat";

export const metadata: Metadata = { title: "Concierge" };

/** Test page for the Gemini concierge agent (/api/agent/chat). Gated by the /chat layout. */
export default function ConciergePage() {
  return <ConciergeChat />;
}
