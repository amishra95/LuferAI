"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Hash, KeyRound, Loader2, MessageCircle, Send, TriangleAlert, Trash2 } from "lucide-react";

import {
  linkSender,
  saveChannelSecrets,
  sendTestMessage,
  setChannelEnabledAction,
  unlinkSender,
  type TestMessageState,
} from "@/app/(dashboard)/settings/channel-actions";
import type { FormState } from "@/app/(dashboard)/settings/actions";
import { PanelErrorBoundary } from "@/components/dashboard/error-boundary";
import { Switch } from "@/components/dashboard/switch";
import { useToast } from "@/components/dashboard/toast";
import { Feedback } from "@/components/settings/settings-forms";
import { submitWithoutReset } from "@/lib/form-submit";
import { cn } from "@/lib/utils";
import type { ChannelId, ChannelLink, DeliveryStatus } from "@/types/channels";

export type ChannelCardProps = {
  channel: ChannelId;
  enabled: boolean;
  configured: boolean;
  editable: boolean;
  webhookUrl: string;
  /** The webhook URL points at localhost, which Meta/Slack can't reach. */
  localUrl: boolean;
  /** Where links and logs are stored. */
  backend: "supabase" | "memory";
  /** Set when channel state couldn't be loaded from storage. */
  loadError?: string;
  envRows: { key: string; label: string; hint: string; set: boolean }[];
  links: ChannelLink[];
  users: { id: string; name: string; company: string }[];
  recent: { id: string; text: string; reply?: string; status: string; delivery: DeliveryStatus; at: string; test: boolean }[];
};

const META = {
  whatsapp: {
    title: "WhatsApp Business",
    blurb: "Guests message your WhatsApp number; the concierge finds venues and files booking requests.",
    icon: MessageCircle,
    senderLabel: "Phone number",
    senderPlaceholder: "+91 98765 43210",
    setup: "Meta app → WhatsApp → Configuration: set the callback URL and verify token, then subscribe to the messages field.",
  },
  slack: {
    title: "Slack bot",
    blurb: "Teams @mention the bot or DM it; replies land in the same thread.",
    icon: Hash,
    senderLabel: "Member ID",
    senderPlaceholder: "U04ABCD123",
    setup: "Slack app → Event Subscriptions: set the request URL, then subscribe to app_mention and message.im bot events.",
  },
} as const;

const IDLE: FormState = { status: "idle" };
const TABS = ["setup", "senders", "test"] as const;
const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

/**
 * Wraps a server action for useActionState: success → toast, validation error →
 * returned for inline display, thrown/network error → error toast plus an
 * inline fallback, so nothing escapes to the route error boundary.
 */
function useGuardedAction<S extends FormState>(action: (prev: S, form: FormData) => Promise<S>, successTitle: string) {
  const toast = useToast();
  return async (prev: S, form: FormData): Promise<S> => {
    try {
      const result = await action(prev, form);
      if (result.status === "success") toast({ tone: "success", title: successTitle, description: result.message });
      return result;
    } catch (err) {
      console.error(err);
      toast({ tone: "error", title: "Request failed", description: UNREACHABLE });
      return { ...prev, status: "error", message: UNREACHABLE };
    }
  };
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <div className="flex gap-2">
      <input readOnly value={value} aria-label="Webhook URL" className="field text-fg-muted font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn h-9 shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast({ tone: "info", title: "Copy blocked by the browser", description: "Select the URL and copy it manually." });
          }
        }}
      >
        {copied ? <Check className="text-sage size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ChannelCard(props: ChannelCardProps) {
  const { channel, enabled, configured, loadError } = props;
  const meta = META[channel];
  const Icon = meta.icon;
  const [tab, setTab] = useState<(typeof TABS)[number]>(configured ? "senders" : "setup");
  const [toggling, startToggle] = useTransition();
  const toast = useToast();

  function toggle() {
    startToggle(async () => {
      try {
        const r = await setChannelEnabledAction(channel, !enabled);
        toast(r.status === "success" ? { tone: "success", title: r.message ?? "Saved" } : { tone: "error", title: "Couldn't change the channel", description: r.message });
      } catch {
        toast({ tone: "error", title: "Couldn't change the channel", description: UNREACHABLE });
      }
    });
  }

  const status = loadError ? (
    <span className="pill border-rose/25 text-rose">
      <span className="bg-rose size-1.5 rounded-full" aria-hidden /> unavailable
    </span>
  ) : !configured ? (
    <span className="pill">
      <span className="border-fg-faint size-1.5 rounded-full border" aria-hidden /> setup needed
    </span>
  ) : enabled ? (
    <span className="pill pill-copper">
      <span className="live-dot" aria-hidden /> live
    </span>
  ) : (
    <span className="pill">
      <span className="bg-fg-subtle size-1.5 rounded-full" aria-hidden /> paused
    </span>
  );

  return (
    <article className="panel overflow-hidden">
      <header className="flex items-start gap-3.5 p-5 sm:p-6">
        <span className="border-line bg-canvas grid size-9 shrink-0 place-items-center rounded-[10px] border" aria-hidden>
          <Icon className="text-fg-muted size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-fg text-[14px] font-semibold tracking-[-0.01em]">{meta.title}</h3>
            {status}
          </div>
          <p className="text-fg-subtle mt-1 text-[12.5px] leading-5">{meta.blurb}</p>
        </div>
        <Switch on={enabled} label={`${enabled ? "Pause" : "Enable"} ${meta.title}`} pending={toggling || Boolean(loadError)} onToggle={toggle} />
      </header>

      {loadError && (
        <p role="alert" className="border-rose/20 bg-rose/[0.04] text-rose mx-5 mb-4 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] sm:mx-6">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Couldn&apos;t load this channel&apos;s state: <span className="font-mono text-[11.5px]">{loadError}</span>. Webhooks answer with 503 (so Meta and
            Slack retry) until storage is back.
          </span>
        </p>
      )}

      <div role="tablist" aria-label={`${meta.title} settings`} className="border-line flex gap-1 border-y px-4 sm:px-5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("relative h-10 px-2.5 text-[12.5px] capitalize transition-colors", tab === t ? "text-fg font-medium" : "text-fg-subtle hover:text-fg")}
          >
            {t === "senders" ? `Senders · ${props.links.length}` : t}
            {tab === t && <span aria-hidden className="bg-copper-deep absolute inset-x-2 -bottom-px h-[2px] rounded-full" />}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="p-5 sm:p-6">
        <PanelErrorBoundary label={`${meta.title} ${tab}`} key={tab}>
          {tab === "setup" && <SetupTab {...props} />}
          {tab === "senders" && <SendersTab {...props} senderLabel={meta.senderLabel} senderPlaceholder={meta.senderPlaceholder} />}
          {tab === "test" && <TestTab {...props} />}
        </PanelErrorBoundary>
      </div>
    </article>
  );
}

function SetupTab({ channel, editable, webhookUrl, localUrl, envRows }: ChannelCardProps) {
  const [state, action, pending] = useActionState(useGuardedAction(saveChannelSecrets, "Credentials saved"), IDLE);
  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono mb-2">Webhook URL</p>
        <CopyField value={webhookUrl} />
        <p className="text-fg-subtle mt-2 text-[12.5px] leading-5">
          {META[channel].setup}
          {localUrl && " Meta and Slack can't reach localhost: start a tunnel (ngrok http 3000) and set PUBLIC_BASE_URL to its https URL — see docs/channels.md."}
        </p>
      </div>

      <form onSubmit={submitWithoutReset(action)} method="post" className="space-y-4">
        <input type="hidden" name="channel" value={channel} />
        <p className="label-mono">Credentials</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {envRows.map((r) => (
            <label key={r.key} className="block min-w-0">
              <span className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-fg text-[12.5px] font-medium">{r.label}</span>
                <span className={cn("font-mono text-[10.5px]", r.set ? "text-sage" : "text-fg-subtle")}>{r.set ? "● set" : "○ not set"}</span>
              </span>
              <span className="relative block">
                <KeyRound className="text-fg-faint pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" aria-hidden />
                <input
                  name={r.key}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!editable}
                  placeholder={r.set ? "Leave blank to keep" : r.key}
                  className="field pl-9 font-mono text-[12px]"
                />
              </span>
              <span className="text-fg-subtle mt-1.5 block text-[11.5px] leading-4">{r.hint}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!editable || pending} className="btn btn-primary">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Save credentials
          </button>
          {!editable && <span className="text-fg-subtle text-[12.5px]">Read-only outside localhost dev.</span>}
          {state.status === "error" && <Feedback state={state} />}
        </div>
      </form>
    </div>
  );
}

function SendersTab({
  channel,
  editable,
  links,
  users,
  backend,
  senderLabel,
  senderPlaceholder,
}: ChannelCardProps & { senderLabel: string; senderPlaceholder: string }) {
  const [state, action, pending] = useActionState(useGuardedAction(linkSender, "Sender linked"), IDLE);
  const [removing, startRemove] = useTransition();
  const toast = useToast();

  function unlink(senderId: string) {
    startRemove(async () => {
      try {
        const r = await unlinkSender(channel, senderId);
        toast(r.status === "success" ? { tone: "success", title: "Sender unlinked" } : { tone: "error", title: "Couldn't unlink", description: r.message });
      } catch {
        toast({ tone: "error", title: "Couldn't unlink", description: UNREACHABLE });
      }
    });
  }

  return (
    <div className="space-y-5">
      <p className="text-fg-subtle text-[12.5px] leading-5">
        Linked senders can file booking requests; they&apos;re booked as the chosen client user, under that user&apos;s company and its policy.
        Anyone else can only search. <span className="font-mono text-[11px]">{backend === "supabase" ? "Stored in Supabase." : "Stored in memory."}</span>
      </p>

      {links.length > 0 ? (
        <ul className="border-line divide-line divide-y rounded-xl border">
          {links.map((l) => (
            <li key={l.senderId} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="text-fg font-mono text-[12px]">{channel === "whatsapp" ? `+${l.senderId}` : l.senderId}</span>
              <span className="text-fg-faint" aria-hidden>
                →
              </span>
              <span className="text-fg-muted min-w-0 truncate text-[12.5px]">{l.userName}</span>
              {l.defaultCostCenter && <span className="text-fg-subtle font-mono text-[11px]">cc {l.defaultCostCenter}</span>}
              <button
                type="button"
                disabled={!editable || removing}
                onClick={() => unlink(l.senderId)}
                aria-label={`Unlink ${l.senderId}`}
                className="btn btn-ghost btn-icon hover:text-rose ml-auto size-7"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-line text-fg-subtle rounded-xl border border-dashed px-4 py-5 text-center text-[12.5px]">No linked senders yet.</p>
      )}

      <form onSubmit={submitWithoutReset(action)} className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
        <input type="hidden" name="channel" value={channel} />
        <label className="block">
          <span className="label-mono mb-2 block">{senderLabel}</span>
          <input name="senderId" required disabled={!editable} placeholder={senderPlaceholder} className="field font-mono" />
        </label>
        <label className="block">
          <span className="label-mono mb-2 block">Books as</span>
          <select name="userId" required disabled={!editable || users.length === 0} defaultValue="" className="field">
            <option value="" disabled>
              {users.length ? "Choose a client user…" : "No client users found"}
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.company}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label-mono mb-2 block">Cost centre</span>
          <input name="costCenter" required disabled={!editable} placeholder="ENG-BLR" maxLength={32} className="field font-mono uppercase" />
        </label>
        <button type="submit" disabled={!editable || pending} className="btn btn-primary h-9">
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Link sender
        </button>
      </form>
      {state.status === "error" && <Feedback state={state} />}
    </div>
  );
}

/** Renders WhatsApp/Slack *bold* the way the recipient will see it. */
function ChatText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
        /^\*[^*]+\*$/.test(part) ? (
          <strong key={i} className="font-semibold">
            {part.slice(1, -1)}
          </strong>
        ) : (
          part
        )
      )}
    </>
  );
}

const OUTCOME_LABEL: Record<string, string> = { booked: "booking filed", replied: "replied", failed: "failed", ignored: "paused", running: "running" };
const DELIVERY_LABEL: Record<DeliveryStatus, string> = { sent: "delivered", failed: "not delivered", pending: "sending", skipped: "test" };

function TestTab({ channel, editable, links, recent }: ChannelCardProps) {
  const toast = useToast();
  const [state, action, pending] = useActionState<TestMessageState, FormData>(async (prev, form) => {
    try {
      const r = await sendTestMessage(prev, form);
      if (r.outcome === "failed") toast({ tone: "error", title: "Agent run failed", description: r.error ?? r.message });
      else if (r.error) toast({ tone: "error", title: "A tool failed during the run", description: r.error });
      else if (r.outcome === "booked") toast({ tone: "success", title: "Booking request filed", description: "It's in the client portal as Pending." });
      return r;
    } catch (err) {
      console.error(err);
      toast({ tone: "error", title: "Test message failed", description: UNREACHABLE });
      return { status: "error", message: UNREACHABLE };
    }
  }, { status: "idle" });
  const example =
    channel === "whatsapp" ? "Dinner for 40 in Indiranagar on 20 Nov, ₹2,500 a head" : "book Copper Courtyard on 20 Nov for 40 people, ₹2,800 a head";
  const failed = state.outcome === "failed" || (state.status === "error" && !state.reply);

  return (
    <div className="space-y-5">
      <p className="text-fg-subtle text-[12.5px] leading-5">
        Runs a message through the live agent exactly as a webhook would, without sending anything to {channel === "whatsapp" ? "WhatsApp" : "Slack"}.
        Follow-up messages from the same sender continue the conversation. Messages from a linked sender can file real booking requests.
      </p>
      <form onSubmit={submitWithoutReset(action)} className="space-y-3">
        <input type="hidden" name="channel" value={channel} />
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <label className="block">
            <span className="label-mono mb-2 block">From</span>
            <select name="senderId" disabled={!editable} defaultValue={links[0]?.senderId ?? ""} className="field">
              <option value="">Unlinked sender</option>
              {links.map((l) => (
                <option key={l.senderId} value={l.senderId}>
                  {l.userName}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label-mono mb-2 block">Message</span>
            <input name="text" required minLength={2} maxLength={1000} disabled={!editable} defaultValue={example} className="field" />
          </label>
        </div>
        <button type="submit" disabled={!editable || pending} className="btn btn-primary">
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
          {pending ? "Agent is working…" : "Send test message"}
        </button>
      </form>

      {pending ? (
        <div className="border-line rounded-xl border bg-zinc-50 p-4" aria-hidden>
          <div className="bg-surface-raised h-3 w-24 animate-pulse rounded" />
          <div className="bg-surface-raised mt-3 h-3 w-full animate-pulse rounded" />
          <div className="bg-surface-raised mt-2 h-3 w-2/3 animate-pulse rounded" />
        </div>
      ) : failed && state.status === "error" ? (
        <div role="alert" className="border-rose/25 bg-rose/[0.04] rounded-xl border p-4">
          <p className="text-rose flex items-center gap-2 text-[13px] font-medium">
            <TriangleAlert className="size-4" aria-hidden /> {state.message ?? "The run failed."}
          </p>
          {state.reply && <p className="text-fg-muted mt-2 text-[12.5px]">The sender would have received: “{state.reply}”</p>}
          {state.error && <p className="text-fg-subtle mt-2 font-mono text-[11.5px] break-words">{state.error}</p>}
        </div>
      ) : state.reply ? (
        <div className="border-line rounded-xl border bg-zinc-50 p-4" aria-live="polite">
          <p className="label-mono mb-2 flex flex-wrap items-center gap-2">
            Reply
            <span className={cn("pill normal-case", state.outcome === "booked" && "pill-copper")}>{OUTCOME_LABEL[state.outcome ?? "replied"]}</span>
            {state.tools?.length ? <span className="text-fg-subtle font-normal tracking-normal normal-case">{state.tools.join(" → ")}</span> : null}
          </p>
          <p className="text-fg text-[13px] leading-6 whitespace-pre-wrap">
            <ChatText text={state.reply} />
          </p>
          {state.error && <p className="text-rose mt-2 font-mono text-[11.5px] break-words">Tool error: {state.error}</p>}
        </div>
      ) : state.status === "error" ? (
        <Feedback state={state} />
      ) : null}

      {recent.length > 0 && (
        <div>
          <p className="label-mono mb-2">Recent</p>
          <ul className="space-y-1.5">
            {recent.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 text-[12.5px]">
                <time className="text-fg-subtle shrink-0 font-mono text-[11px] tabular-nums">{e.at}</time>
                <span className="text-fg-muted min-w-0 flex-1 truncate">“{e.text}”</span>
                <span className={cn("shrink-0 font-mono text-[11px]", e.status === "failed" || e.delivery === "failed" ? "text-rose" : "text-fg-subtle")}>
                  {OUTCOME_LABEL[e.status] ?? e.status} · {DELIVERY_LABEL[e.delivery]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
