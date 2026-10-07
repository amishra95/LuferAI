import type { Metadata } from "next";

import { AGENT_GRID, AgentRow } from "@/components/agents/agent-row";
import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { agentSnapshot } from "@/lib/agents/store";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  const { now, agents } = agentSnapshot();
  const counts = agents.reduce<Record<string, number>>((acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {});

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Switch agents on, assign their tools and smoke-test them against live app data."
        badge={<NoticePill>in memory</NoticePill>}
        actions={
          <p className="text-fg-subtle font-mono text-[11.5px]">
            {(["active", "idle", "error", "disabled"] as const)
              .filter((s) => counts[s])
              .map((s) => `${counts[s]} ${s}`)
              .join("  ·  ")}
          </p>
        }
      />

      <div className="panel overflow-hidden">
        <div className={cn("border-line hidden border-b px-5 py-2.5", AGENT_GRID)} aria-hidden>
          {["Agent", "Status", "Tools", "Last run", "Runs", "Steps", "Temp", ""].map((h, i) => (
            <span key={i} className={cn("label-mono", i >= 4 && i <= 6 && "text-right")}>
              {h}
            </span>
          ))}
        </div>
        <ul>
          {agents.map(({ agent, status }) => (
            <AgentRow key={agent.id} agent={agent} status={status} now={now} />
          ))}
        </ul>
      </div>

      <p className="text-fg-subtle mt-4 text-[12.5px] leading-5">
        Test runs call each assigned tool once with a sample input and don&apos;t call the model. Chat messages count as workspace-agent
        runs. Settings live in server memory and reset on restart.
      </p>
    </Page>
  );
}
