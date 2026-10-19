import type { Metadata } from "next";

import { AGENT_GRID, AgentRow } from "@/components/agents/agent-row";
import { Inspector } from "@/components/agents/inspector";
import { ProviderHealthPanel } from "@/components/agents/provider-health";
import { SpendWidget } from "@/components/agents/spend-widget";
import { KINDS, OUTCOMES, TraceFeed, type KindFilter, type OutcomeFilter } from "@/components/agents/trace-feed";
import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { DEFAULT_BACKEND, MODEL_BACKEND_LABEL, MODEL_BACKENDS } from "@/lib/agents/config";
import { FALLBACK_PATH, getObservabilityFeed, guardrailInventory, PRICING_RULES, providerHealth } from "@/lib/agents/observability";
import { agentSnapshot, settingsStore } from "@/lib/agents/store";
import { isBackendConfigured } from "@/lib/ai/model";
import { PROMPT_TEMPLATES } from "@/lib/ai/prompts";
import { isRedisConfigured } from "@/lib/data/local-store";
import { spendSnapshot } from "@/lib/telemetry/usage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents" };

const pick = <T extends string>(options: { value: T }[], raw: string | string[] | undefined, fallback: T): T =>
  options.some((o) => o.value === raw) ? (raw as T) : fallback;

export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const params = await searchParams;
  const kind = pick<KindFilter>(KINDS, params.kind, "all");
  const outcome = pick<OutcomeFilter>(OUTCOMES, params.outcome, "all");

  const [{ now, agents }, spend, feed] = await Promise.all([agentSnapshot(), spendSnapshot(), getObservabilityFeed()]);
  const health = await providerHealth(feed.events, now);
  const backends = MODEL_BACKENDS.map((id) => ({ id, configured: isBackendConfigured(id) }));
  const agentNames = Object.fromEntries(agents.map(({ agent }) => [agent.id, agent.name]));
  const store = settingsStore();
  const counts = agents.reduce<Record<string, number>>((acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {});

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Switch agents on, choose their model and tools, inspect their prompts and guardrails, and trace every negotiation, rule check and model call."
        badge={<NoticePill>{`settings in ${store}${isRedisConfigured() ? " · runs in redis" : ""}`}</NoticePill>}
        actions={
          <Inspector
            prompts={PROMPT_TEMPLATES}
            guardrails={guardrailInventory()}
            pricing={PRICING_RULES}
            model={health.configured ? MODEL_BACKEND_LABEL[DEFAULT_BACKEND] : null}
          />
        }
      />

      <ProviderHealthPanel health={health} fallbacks={FALLBACK_PATH} now={now} />

      <div className="mt-6">
        <SpendWidget summary={spend.summary} store={spend.source} agentNames={agentNames} />
      </div>

      <section aria-labelledby="agents-heading" className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="agents-heading" className="text-fg text-[15px] font-semibold tracking-tight">
            Configured agents
          </h2>
          <p className="text-fg-subtle font-mono text-[11.5px]">
            {(["active", "idle", "error", "disabled"] as const)
              .filter((s) => counts[s])
              .map((s) => `${counts[s]} ${s}`)
              .join("  ·  ")}
          </p>
        </div>
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
        <p className="text-fg-subtle mt-3 text-[12.5px] leading-5">
          Test runs call each assigned tool once with a sample input and don&apos;t call the model; live runs (in an agent&apos;s settings) do, and count as
          test runs. Chat messages count as workspace-agent runs.{" "}
          {store === "supabase"
            ? "Settings are saved in Supabase."
            : "Settings live in server memory and reset on restart until migration 0024 (agent_configurations) is applied."}{" "}
          Token usage is logged per model call; spend is at list price.
        </p>
      </section>

      <div className="mt-10">
        <TraceFeed events={feed.events} kind={kind} outcome={outcome} now={now} errors={feed.errors} />
      </div>
    </Page>
  );
}
