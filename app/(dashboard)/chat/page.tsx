import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { getAgent } from "@/lib/agents/store";
import { getLanguageModel } from "@/lib/ai/model";
import { getPreferences } from "@/lib/settings/preferences";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  const model = getLanguageModel();
  const { inspectorOpen } = await getPreferences();
  // Re-rendered live when the agent is switched on or off elsewhere (LiveRefresh).
  const agentEnabled = getAgent("workspace-agent")?.enabled ?? true;
  return <ChatWorkspace model={model?.modelId ?? "none"} offline={!model} agentEnabled={agentEnabled} defaultInspectorOpen={inspectorOpen} />;
}
