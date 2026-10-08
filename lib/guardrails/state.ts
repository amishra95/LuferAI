import "server-only";

import { createHash } from "node:crypto";

import { getDataRedis } from "@/lib/data/local-store";
import { GUARDRAIL_LIMITS } from "./schemas";

/**
 * Per-sender booking activity for the createBooking guardrail: bookings filed
 * in the last hour, and venue/date pairs already requested. Upstash Redis when
 * configured (shared by all instances), else process memory.
 *
 * Sender ids (phone numbers, Slack member ids) are hashed before they reach a
 * key, so Redis holds no raw identifiers.
 */

const HOUR_MS = 3_600_000;
interface GuardMemory {
  filed: Map<string, number[]>;
  seen: Map<string, number>;
}
const g = globalThis as typeof globalThis & { __luferGuardMemory?: GuardMemory };
const memory: GuardMemory = (g.__luferGuardMemory ??= { filed: new Map(), seen: new Map() });

const senderKey = (channel: string, senderId: string) => createHash("sha256").update(`${channel}:${senderId}`).digest("hex").slice(0, 32);
const filedKey = (sender: string) => `lufer:guard:filed:${sender}`;
const seenKey = (sender: string, venueId: string, eventDate: string) => `lufer:guard:seen:${sender}:${venueId}:${eventDate}`;

export async function bookingActivity(channel: string, senderId: string, venueId: string, eventDate: string) {
  const sender = senderKey(channel, senderId);
  const since = Date.now() - HOUR_MS;
  const redis = getDataRedis();
  if (!redis) {
    const filed = (memory.filed.get(sender) ?? []).filter((t) => t > since);
    const seenUntil = memory.seen.get(seenKey(sender, venueId, eventDate)) ?? 0;
    return { bookingsLastHour: filed.length, duplicate: seenUntil > Date.now() };
  }
  const [, count, seen] = await redis
    .pipeline()
    .zremrangebyscore(filedKey(sender), 0, since)
    .zcard(filedKey(sender))
    .exists(seenKey(sender, venueId, eventDate))
    .exec<[unknown, number, number]>();
  return { bookingsLastHour: Number(count), duplicate: Number(seen) > 0 };
}

/** Call after a booking request was actually filed. */
export async function recordBooking(channel: string, senderId: string, venueId: string, eventDate: string) {
  const sender = senderKey(channel, senderId);
  const now = Date.now();
  const dupMs = GUARDRAIL_LIMITS.booking.duplicateWindowHours * HOUR_MS;
  const redis = getDataRedis();
  if (!redis) {
    memory.filed.set(sender, [...(memory.filed.get(sender) ?? []).filter((t) => t > now - HOUR_MS), now]);
    memory.seen.set(seenKey(sender, venueId, eventDate), now + dupMs);
    return;
  }
  await redis
    .pipeline()
    .zadd(filedKey(sender), { score: now, member: `${now}:${crypto.randomUUID()}` })
    .pexpire(filedKey(sender), HOUR_MS)
    .set(seenKey(sender, venueId, eventDate), "1", { px: dupMs })
    .exec();
}
