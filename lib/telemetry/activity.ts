import "server-only";

import { channelStore } from "@/lib/channels/store";
import { listAgentRuns, type LoggedRun } from "@/lib/telemetry/runs";
import type { ChannelEvent } from "@/types/channels";
import type { AgentTaskEvent, TaskStatus } from "@/types/telemetry";

const STATUS: Record<ChannelEvent["status"], TaskStatus> = {
  running: "running",
  replied: "succeeded",
  booked: "succeeded",
  failed: "failed",
  ignored: "queued",
};

function fromChannelEvent(e: ChannelEvent): AgentTaskEvent {
  const who = e.senderName ?? e.sender;
  const log =
    e.status === "failed"
      ? (e.error ?? "Agent run failed")
      : e.status === "booked"
        ? `Booking request filed${e.bookingId ? ` · ref ${e.bookingId.slice(0, 8)}` : ""}`
        : e.status === "running"
          ? "Working on a reply…"
          : (e.reply?.replace(/\s*\n+\s*•?\s*/g, " ").replace(/\*/g, "") ?? "Replied");
  return {
    id: e.id.slice(0, 8),
    agent: "channel-concierge",
    task: `${who}${e.test ? " (test)" : ""}: “${e.text.length > 90 ? `${e.text.slice(0, 90)}…` : e.text}”`,
    status: STATUS[e.status],
    step: e.steps,
    totalSteps: Math.max(e.steps, 1),
    durationMs: e.durationMs,
    tokens: e.tokens,
    startedAt: e.at,
    log,
    channel: e.channel,
  };
}

function fromRun(r: LoggedRun): AgentTaskEvent {
  return {
    id: r.id.slice(0, 8),
    agent: r.agent,
    task: r.task,
    status: r.ok ? "succeeded" : "failed",
    step: r.steps,
    totalSteps: Math.max(r.steps, 1),
    durationMs: r.durationMs,
    tokens: r.tokens,
    // Runs are logged when they finish; the feed is ordered by start.
    startedAt: new Date(new Date(r.at).getTime() - r.durationMs).toISOString(),
    log: r.ok ? `Completed in ${(r.durationMs / 1000).toFixed(2)} s` : (r.error ?? "Run failed"),
    channel: r.channel,
  };
}

/**
 * Activity for the Overview, all recorded: WhatsApp/Slack runs from the channel
 * message log, plus web runs (workspace chat, AI routes, agent tests) from the
 * Redis run log. Channel runs are also in the run log (for the metrics) but are
 * shown from the message log, which has the sender and reply.
 * Either source failing leaves the other rendering; `liveError` says why.
 */
export async function getActivity(limit = 25) {
  const now = new Date();
  const errors: string[] = [];
  const [channelEvents, runs] = await Promise.all([
    channelStore()
      .listEvents({ limit: 50 })
      .catch((err): ChannelEvent[] => {
        console.error("overview: could not load channel activity", err);
        errors.push(err instanceof Error ? err.message : "Could not load channel activity");
        return [];
      }),
    listAgentRuns(500).catch((err): LoggedRun[] => {
      console.error("overview: could not load agent runs", err);
      errors.push(err instanceof Error ? err.message : "Could not load agent runs");
      return [];
    }),
  ]);
  const events = [
    ...channelEvents.filter((e) => e.status !== "ignored").map(fromChannelEvent),
    ...runs.filter((r) => r.channel === "web").map(fromRun),
  ]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
  return { now, events, runs, channelEvents, liveError: errors.length ? errors.join("; ") : undefined };
}
