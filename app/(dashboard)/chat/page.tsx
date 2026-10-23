import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { getAgent, syncAgentConfigs } from "@/lib/agents/store";
import { getLanguageModel } from "@/lib/ai/model";
import { getCurrentMember } from "@/lib/auth/session";
import { draftFromParam } from "@/lib/chat/concierge-link";
import { listCompanies } from "@/lib/data";
import { getPreferences } from "@/lib/settings/preferences";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  await syncAgentConfigs();
  const agent = getAgent("workspace-agent");
  const model = getLanguageModel({ backend: agent?.model, speed: "fast" });
  const [{ inspectorOpen }, member, { company: companyParam, prompt }] = await Promise.all([getPreferences(), getCurrentMember(), searchParams]);
  // Company context from the portal (?company=): admins may name any company; clients always see their own.
  const companyId = member?.role === "ADMIN" ? (typeof companyParam === "string" ? companyParam : null) : member?.companyId;
  const company = companyId ? (await listCompanies()).find((c) => c.id === companyId) : undefined;
  // Re-rendered live when the agent is switched on or off elsewhere (LiveRefresh).
  const agentEnabled = agent?.enabled ?? true;
  return (
    <ChatWorkspace
      model={model?.modelId ?? "none"}
      offline={!model}
      agentEnabled={agentEnabled}
      // The tool inspector is operator detail: open by preference for admins, on demand for everyone else.
      defaultInspectorOpen={member?.role === "ADMIN" && inspectorOpen}
      companyName={company?.legal_name}
      initialDraft={draftFromParam(prompt)}
    />
  );
}
