import type { Metadata } from "next";

import { AGENT_GRID, AgentRow } from "@/components/agents/agent-row";
import { SpendWidget } from "@/components/agents/spend-widget";
import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { MODEL_BACKENDS } from "@/lib/agents/config";
import { agentSnapshot, settingsStore } from "@/lib/agents/store";
import { isBackendConfigured } from "@/lib/ai/model";
import { isRedisConfigured } from "@/lib/data/local-store";
import { spendSnapshot } from "@/lib/telemetry/usage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const [{ now, agents }, spend] = await Promise.all([agentSnapshot(), spendSnapshot()]);
  const backends = MODEL_BACKENDS.map((id) => ({ id, configured: isBackendConfigured(id) }));
  const agentNames = Object.fromEntries(agents.map(({ agent }) => [agent.id, agent.name]));
  const store = settingsStore();
  const counts = agents.reduce<Record<string, number>>((acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {});

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Switch agents on, choose their model and tools, watch a run step by step, and track what they spend."
        badge={<NoticePill>{`settings in ${store}${isRedisConfigured() ? " · runs in redis" : ""}`}</NoticePill>}
        actions={
          <p className="text-fg-subtle font-mono text-[11.5px]">
            {(["active", "idle", "error", "disabled"] as const)
              .filter((s) => counts[s])
              .map((s) => `${counts[s]} ${s}`)
              .join("  ·  ")}
          </p>
        }
      />

      <SpendWidget summary={spend.summary} store={spend.source} agentNames={agentNames} />

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
            <AgentRow key={agent.id} agent={agent} status={status} now={now} backends={backends} />
          ))}
        </ul>
      </div>

      <p className="text-fg-subtle mt-4 text-[12.5px] leading-5">
        Test runs call each assigned tool once with a sample input and don&apos;t call the model; live runs (in an agent&apos;s settings) do, and count as
        test runs. Chat messages count as workspace-agent runs.{" "}
        {store === "supabase"
          ? "Settings are saved in Supabase."
          : "Settings live in server memory and reset on restart until migration 0024 (agent_configurations) is applied."}{" "}
        Token usage is logged per model call; spend is at list price.
      </p>
    </Page>
  );
}
