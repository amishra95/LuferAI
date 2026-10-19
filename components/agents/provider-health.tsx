import { LifeBuoy } from "lucide-react";

import { Pill, type PillTone } from "@/components/portal/pills";
import { cn } from "@/lib/utils";
import type { ProviderHealth } from "@/types/agents";

/** The agents whose failures have a manual path, in the order a reader meets them. */
const FALLBACK_ROWS: { agent: string; name: string; surface: string }[] = [
  { agent: "property-negotiator", name: "Property negotiator", surface: "/property" },
  { agent: "brief-writer", name: "Brief writer", surface: "/property" },
  { agent: "rfp-broadcaster", name: "RFP broadcaster", surface: "/client" },
  { agent: "venue-sourcer", name: "Venue sourcer", surface: "/client" },
  { agent: "channel-concierge", name: "Channel concierge", surface: "WhatsApp · Slack" },
  { agent: "workspace-agent", name: "Workspace agent", surface: "/chat" },
];

function headline(h: ProviderHealth, now: number): { tone: PillTone; label: string; body: string } {
  if (!h.configured) {
    return {
      tone: "error",
      label: "AI off",
      body: "The default model backend has no API key in this environment. AI routes answer 503 without calling a model, and every surface falls back to its manual path below.",
    };
  }
  // With several instances, say how many tripped: each breaker trips on its own.
  const where = h.instances > 1 ? ` on ${h.degradedInstances} of ${h.instances} instances` : "";
  if (h.circuit === "OPEN") {
    const s = h.retryAt ? Math.max(1, Math.ceil((h.retryAt - now) / 1000)) : null;
    return {
      tone: "error",
      label: `Circuit open${where}${s ? ` · retry in ${s}s` : ""}`,
      body: `${h.consecutiveFailures} calls in a row failed (rate limits, exhausted credits or provider errors), so model calls are refused without trying. Requests get “temporarily unavailable” and people use the manual paths below until a trial call succeeds.`,
    };
  }
  if (h.circuit === "HALF_OPEN") {
    return { tone: "warn", label: `Recovering${where}`, body: "The provider failed recently. Trial calls are going through; the circuit closes after two succeed." };
  }
  if (h.fallbacks24h > 0) {
    return {
      tone: "warn",
      label: `Healthy · ${h.fallbacks24h} fallback${h.fallbacks24h === 1 ? "" : "s"} in 24 h`,
      body: "Model calls are going through now. Filter the feed to Error/Fallback to see what failed and which manual path took over.",
    };
  }
  return { tone: "ok", label: "Healthy", body: "Model calls are going through. Failed calls are retried with backoff (up to 3 times) before an agent falls back." };
}

const SCOPE: Record<ProviderHealth["store"], string> = {
  redis: "All instances, last 24 h (Redis)",
  memory: "This instance, last 24 h (no Redis configured)",
  instance: "This instance since it started (health store unavailable)",
};

const ago = (at: number, now: number) => {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** `fallbacks`: manual path per agent (FALLBACK_PATH in lib/agents/observability). */
export function ProviderHealthPanel({ health, fallbacks, now }: { health: ProviderHealth; fallbacks: Record<string, string>; now: number }) {
  const h = headline(health, now);
  const degraded = h.tone !== "ok";
  return (
    <section aria-labelledby="provider-heading" className={cn("panel overflow-hidden", h.tone === "error" && "border-rose/30")}>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="provider-heading" className="text-fg text-[13.5px] font-medium">
              AI provider
            </h2>
            <Pill tone={h.tone}>{h.label}</Pill>
            {health.backends.map((b) => (
              <span key={b.id} className={cn("font-mono text-[11px]", b.configured ? "text-fg-subtle" : "text-fg-faint line-through")} title={b.configured ? `${b.label}: key set` : `${b.label}: no API key`}>
                {b.label}
              </span>
            ))}
          </div>
          <p className="text-fg-subtle mt-1.5 text-[12.5px] leading-5" role={h.tone === "error" ? "alert" : undefined}>
            {h.body}
          </p>
        </div>
        <div className="text-right">
        <dl className="text-fg-muted grid grid-cols-4 gap-x-5 gap-y-0.5 font-mono text-[12px] tabular-nums" title={SCOPE[health.store]}>
          {(
            [
              ["calls", health.stats.calls],
              ["failed", health.stats.failures],
              ["retries", health.stats.retries],
              ["refused", health.stats.rejected],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="text-right">
              <dt className="label-mono">{label}</dt>
              <dd className={cn(label !== "calls" && value > 0 && "text-fg")}>{value}</dd>
            </div>
          ))}
        </dl>
          <p className="text-fg-faint mt-1 font-mono text-[11px]">
            {health.store === "redis" ? `${health.instances} instance${health.instances === 1 ? "" : "s"} · 24 h` : health.store === "memory" ? "this instance · 24 h" : "this instance"}
          </p>
        </div>
      </div>

      {health.transitions.length > 0 && (
        <div className="border-line border-t px-5 py-2.5">
          <span className="label-mono">Recent circuit changes</span>
          <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px]">
            {health.transitions.map((t) => (
              <li key={`${t.instance}:${t.at}:${t.to}`} className="text-fg-subtle flex flex-wrap gap-x-3">
                <span className={cn(t.to === "OPEN" ? "text-rose" : t.to === "CLOSED" ? "text-fg-muted" : "text-fg")}>
                  {t.from} → {t.to}
                </span>
                <span className="text-fg-faint">{t.instance}</span>
                <time className="text-fg-faint ml-auto" dateTime={new Date(t.at).toISOString()}>
                  {ago(t.at, now)}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details open={degraded} className="border-line group border-t">
        <summary className="hover:bg-surface-hover flex cursor-pointer list-none items-center gap-2 px-5 py-2.5">
          <LifeBuoy className="text-fg-subtle size-3.5" aria-hidden />
          <span className="label-mono">Human-in-the-loop fallback</span>
          <span className="text-fg-faint ml-auto text-[12px] group-open:hidden">What happens when a model call fails</span>
        </summary>
        <ul className="divide-line divide-y px-5 pb-2">
          {FALLBACK_ROWS.map((r) => (
            <li key={r.agent} className="grid gap-1 py-2.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
              <span className="text-[12.5px]">
                <span className="text-fg">{r.name}</span> <span className="text-fg-subtle font-mono text-[11px]">{r.surface}</span>
              </span>
              <span className="text-fg-subtle text-[12.5px] leading-5">{fallbacks[r.agent]}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
