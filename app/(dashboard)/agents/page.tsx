import type { Metadata } from "next";

import { AgentCard } from "@/components/agents/agent-card";
import { NoticePill, PageHeader } from "@/components/dashboard/page-header";
import { agentSnapshot } from "@/lib/agents/store";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  const { now, agents } = agentSnapshot();
  const counts = agents.reduce<Record<string, number>>((acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {});

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Agents"
        description="Enable agents, assign tools and run smoke tests against live app data."
        badge={<NoticePill tone="zinc">In memory · resets on restart</NoticePill>}
        actions={
          <p className="font-mono text-xs text-zinc-500">
            {(["active", "idle", "error", "disabled"] as const)
              .filter((s) => counts[s])
              .map((s) => `${counts[s]} ${s}`)
              .join(" · ")}
          </p>
        }
      />

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map(({ agent, status }) => (
          <AgentCard key={agent.id} agent={agent} status={status} now={now} />
        ))}
      </div>

      <p className="mt-4 text-xs text-zinc-500">
        Test runs call each assigned tool once with a sample input; they don&apos;t call the model. Chat messages count as runs of
        the workspace agent.
      </p>
    </div>
  );
}
