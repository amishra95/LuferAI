import type { Metadata } from "next";
import { CheckCircle2, Circle, Database, Sparkles, SlidersHorizontal, XCircle } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { OpenAIForm, PreferencesForm } from "@/components/settings/settings-forms";
import { getPreferences } from "@/lib/settings/preferences";
import { canEditEnvFile, getOpenAIStatus, getSupabaseStatus } from "@/lib/settings/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

function Card({
  icon: Icon,
  title,
  description,
  status,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex gap-3">
          <Icon className="mt-0.5 size-4 text-zinc-500" />
          <div>
            <h2 className="text-sm font-medium text-zinc-50">{title}</h2>
            <p className="mt-0.5 text-xs text-zinc-400">{description}</p>
          </div>
        </div>
        {status}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const cls = {
    ok: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    warn: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    error: "border-red-500/20 bg-red-500/10 text-red-400",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium", cls)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: React.ReactNode }) {
  const Icon = ok === null ? Circle : ok ? CheckCircle2 : XCircle;
  return (
    <li className="flex items-center gap-2.5 py-2 text-sm">
      <Icon className={cn("size-4 shrink-0", ok === null ? "text-zinc-600" : ok ? "text-emerald-400" : "text-red-400")} aria-hidden />
      <span className="text-zinc-300">{label}</span>
      {detail && <span className="ml-auto truncate pl-3 text-right font-mono text-xs text-zinc-500">{detail}</span>}
      <span className="sr-only">{ok === null ? "not checked" : ok ? "ok" : "missing"}</span>
    </li>
  );
}

export default async function SettingsPage() {
  const [openai, supabase, editable, prefs] = await Promise.all([
    getOpenAIStatus(),
    getSupabaseStatus(),
    canEditEnvFile(),
    getPreferences(),
  ]);

  const supabaseTone = !supabase.configured ? "warn" : supabase.ping?.ok ? "ok" : "error";
  const supabaseLabel = !supabase.configured ? "Using mock data" : supabase.ping?.ok ? "Connected" : "Unreachable";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader title="Settings" description="API keys, data connections and workspace preferences." />

      <div className="mt-6 space-y-4">
        <Card
          icon={Sparkles}
          title="OpenAI"
          description="Powers the Chat workspace and AI features. Without a key, Chat runs in demo mode."
          status={openai.configured ? <StatusPill tone="ok">Live · {openai.model}</StatusPill> : <StatusPill tone="warn">Demo mode</StatusPill>}
        >
          <OpenAIForm status={openai} editable={editable} />
          {openai.source === "environment" && (
            <p className="mt-3 text-xs text-zinc-500">
              The current key comes from the process environment, not .env.local, so it can&apos;t be removed here.
            </p>
          )}
        </Card>

        <Card
          icon={Database}
          title="Supabase"
          description="Venue, booking and policy data. Without it the app uses the built-in mock store."
          status={<StatusPill tone={supabaseTone}>{supabaseLabel}</StatusPill>}
        >
          <ul className="divide-y divide-zinc-800/70">
            <Check ok={Boolean(supabase.urlHost) && supabase.urlHost !== "invalid URL"} label="NEXT_PUBLIC_SUPABASE_URL" detail={supabase.urlHost ?? "not set"} />
            <Check ok={supabase.anonKey} label="NEXT_PUBLIC_SUPABASE_ANON_KEY" detail={supabase.anonKey ? "set" : "not set"} />
            <Check ok={supabase.serviceRoleKey} label="SUPABASE_SERVICE_ROLE_KEY" detail={supabase.serviceRoleKey ? "set · server only" : "not set"} />
            <Check
              ok={supabase.ping ? supabase.ping.ok : null}
              label="Connection"
              detail={
                !supabase.ping
                  ? "skipped, not configured"
                  : supabase.ping.ok
                    ? `${supabase.ping.latencyMs} ms · ${supabase.ping.venues} venues`
                    : supabase.ping.error
              }
            />
          </ul>
          <p className="mt-3 text-xs text-zinc-500">
            Set these in <code className="font-mono text-zinc-400">.env.local</code> (see{" "}
            <code className="font-mono text-zinc-400">.env.example</code>) and restart the dev server. Checked on each page load.
          </p>
        </Card>

        <Card icon={SlidersHorizontal} title="Workspace" description="Saved in this browser.">
          <PreferencesForm workspaceName={prefs.workspaceName} inspectorOpen={prefs.inspectorOpen} />
        </Card>
      </div>
    </div>
  );
}
