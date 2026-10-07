import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { getLanguageModel } from "@/lib/ai/model";
import { getPreferences } from "@/lib/settings/preferences";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  const model = getLanguageModel();
  const { inspectorOpen } = await getPreferences();
  return <ChatWorkspace model={model?.modelId ?? "demo"} demo={!model} defaultInspectorOpen={inspectorOpen} />;
}
