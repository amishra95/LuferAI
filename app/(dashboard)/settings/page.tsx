import type { Metadata } from "next";
import { headers } from "next/headers";

import { Page, PageHeader } from "@/components/dashboard/page-header";
import { ChannelCard } from "@/components/settings/channel-card";
import { OpenAIForm, PreferencesForm, SupabaseTest } from "@/components/settings/settings-forms";
import { CHANNEL_ENV, env, isChannelConfigured } from "@/lib/channels/config";
import { isChannelEnabled, listEvents, listLinks } from "@/lib/channels/store";
import { listCompanies, listPortalUsers } from "@/lib/data";
import { getPreferences } from "@/lib/settings/preferences";
import { canEditEnvFile, getOpenAIStatus, getSupabaseStatus } from "@/lib/settings/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

/** Two-column settings row: what it is on the left, the controls on the right. */
function Section({
  title,
  description,
  status,
  bare = false,
  children,
}: {
  title: string;
  description: React.ReactNode;
  status?: React.ReactNode;
  /** Children bring their own cards instead of sitting in one panel. */
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line grid gap-5 border-t py-9 first:border-t-0 first:pt-0 md:grid-cols-[15rem_1fr] md:gap-10">
      <div>
        <h2 className="text-fg text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="text-fg-subtle mt-1.5 text-[12.5px] leading-5">{description}</p>
        {status && <div className="mt-3">{status}</div>}
      </div>
      {bare ? <div className="min-w-0 space-y-4">{children}</div> : <div className="panel min-w-0 p-5 sm:p-6">{children}</div>}
    </section>
  );
}

function StatusPill({ tone, children }: { tone: "live" | "ok" | "off" | "error"; children: React.ReactNode }) {
  const dot = {
    live: "live-dot",
    ok: "size-1.5 rounded-full bg-sage",
    off: "size-1.5 rounded-full border border-fg-faint",
    error: "size-1.5 rounded-full bg-rose",
  }[tone];
  return (
    <span className={cn("pill", tone === "live" && "pill-copper", tone === "error" && "border-rose/25 text-rose", tone === "ok" && "text-sage")}>
      <span className={dot} aria-hidden />
      {children}
    </span>
  );
}

function EnvRow({ name, ok, detail }: { name: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-sage" : "border-fg-faint border")} aria-hidden />
      <span className="text-fg-muted min-w-0 truncate font-mono text-[12px]">{name}</span>
      <span className={cn("ml-auto shrink-0 font-mono text-[11.5px]", ok ? "text-fg-muted" : "text-fg-subtle")}>{detail}</span>
      <span className="sr-only">{ok ? "set" : "not set"}</span>
    </li>
  );
}

export default async function SettingsPage() {
  const [openai, supabase, editable, prefs, users, companies, h] = await Promise.all([
    getOpenAIStatus(),
    getSupabaseStatus(),
    canEditEnvFile(),
    getPreferences(),
    listPortalUsers(),
    listCompanies(),
    headers(),
  ]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const localUrl = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const companyName = new Map(companies.map((c) => [c.id, c.legal_name.replace(" Private Limited", "")]));
  const clientUsers = users
    .filter((u) => u.companyId)
    .map((u) => ({ id: u.id, name: u.name, company: companyName.get(u.companyId!) ?? "" }));
  const time = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  const channelProps = (["whatsapp", "slack"] as const).map((channel) => ({
    channel,
    enabled: isChannelEnabled(channel),
    configured: isChannelConfigured(channel),
    editable,
    webhookUrl: `${origin}/api/webhooks/${channel}`,
    localUrl,
    envRows: CHANNEL_ENV[channel].map((f) => ({ key: f.key, label: f.label, hint: f.hint, set: Boolean(env(f.key)) })),
    links: listLinks(channel),
    users: clientUsers,
    recent: listEvents(channel)
      .slice(0, 4)
      .map((e) => ({ id: e.id, text: e.text, reply: e.reply, status: e.status, at: time.format(new Date(e.at)), test: e.test })),
  }));
  const urlOk = Boolean(supabase.urlHost) && supabase.urlHost !== "invalid URL";

  return (
    <Page width="narrow">
      <PageHeader title="Settings" description="Model keys, data connections and workspace preferences." />

      <div>
        <Section
          title="OpenAI"
          description="Powers Chat and the AI features. Without a key, Chat runs scripted demo replies."
          status={openai.configured ? <StatusPill tone="live">live · {openai.model}</StatusPill> : <StatusPill tone="off">demo mode</StatusPill>}
        >
          <OpenAIForm status={openai} editable={editable} />
          {openai.source === "environment" && (
            <p className="text-fg-subtle mt-4 text-[12.5px]">This key comes from the process environment, not .env.local, so it can&apos;t be removed here.</p>
          )}
        </Section>

        <Section
          title="Supabase"
          description={
            <>
              Venue, booking and policy data. Without it the app uses the built-in mock store. Set these in{" "}
              <code className="text-fg-muted font-mono">.env.local</code> and restart the dev server.
            </>
          }
          status={
            !supabase.configured ? (
              <StatusPill tone="off">mock data</StatusPill>
            ) : supabase.ping?.ok ? (
              <StatusPill tone="ok">connected · {supabase.ping.latencyMs} ms</StatusPill>
            ) : (
              <StatusPill tone="error">unreachable</StatusPill>
            )
          }
        >
          <ul className="divide-line -mt-2.5 mb-4 divide-y">
            <EnvRow name="NEXT_PUBLIC_SUPABASE_URL" ok={urlOk} detail={supabase.urlHost ?? "not set"} />
            <EnvRow name="NEXT_PUBLIC_SUPABASE_ANON_KEY" ok={supabase.anonKey} detail={supabase.anonKey ? "set" : "not set"} />
            <EnvRow name="SUPABASE_SERVICE_ROLE_KEY" ok={supabase.serviceRoleKey} detail={supabase.serviceRoleKey ? "set · server only" : "not set"} />
          </ul>
          {supabase.ping && !supabase.ping.ok && <p className="text-rose mb-4 font-mono text-[11.5px]">{supabase.ping.error}</p>}
          <SupabaseTest configured={supabase.configured} />
        </Section>

        <Section
          title="Channels & Integrations"
          description="Take booking requests over WhatsApp and Slack. Messages run through the Channel concierge agent, with the same pricing, policy and hold checks as the client portal. Sender links reset on restart."
          bare
        >
          {channelProps.map((p) => (
            <ChannelCard key={p.channel} {...p} />
          ))}
        </Section>

        <Section title="Workspace" description="Personal preferences, saved in this browser.">
          <PreferencesForm workspaceName={prefs.workspaceName} inspectorOpen={prefs.inspectorOpen} />
        </Section>
      </div>
    </Page>
  );
}
