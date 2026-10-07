import "server-only";

import { listEvents } from "@/lib/channels/store";
import { getSampleAgentTasks } from "@/lib/telemetry/sample-data";
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
    sample: false,
  };
}

/** Activity for the Overview: live WhatsApp/Slack runs first, then sample rows. */
export function getActivity(limit = 10) {
  const now = new Date();
  const live = listEvents()
    .filter((e) => e.status !== "ignored")
    .map(fromChannelEvent);
  const events = [...live, ...getSampleAgentTasks(now)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, Math.max(limit, live.length));
  return { now, events, liveCount: live.length };
}
