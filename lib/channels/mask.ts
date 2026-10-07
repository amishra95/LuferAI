import type { ChannelId } from "@/types/channels";

/** "+9198•••3210" / "U04•••9XK": enough to recognise a sender without exposing it. */
export function maskSender(channel: ChannelId, id: string): string {
  if (channel === "whatsapp") return id.length > 6 ? `+${id.slice(0, 4)}•••${id.slice(-4)}` : `+${id}`;
  return id.length > 6 ? `${id.slice(0, 3)}•••${id.slice(-3)}` : id;
}
