export type ChannelId = "whatsapp" | "slack";
/** Where an agent task came from. "web" is the Chat workspace. */
export type TaskChannel = ChannelId | "web";

export type ChannelLink = {
  channel: ChannelId;
  /** WhatsApp: the sender's phone number (wa_id, digits only). Slack: the member ID (U…). */
  senderId: string;
  /** Portal user the sender books as; bookings are filed under their company. */
  userId: string;
  companyId: string;
  userName: string;
};

export type ChannelEventStatus = "running" | "replied" | "booked" | "failed" | "ignored";

export type DeliveryStatus = "pending" | "sent" | "failed" | "skipped";

export type ChannelEvent = {
  id: string;
  channel: ChannelId;
  /** Raw sender ID (wa_id / Slack member ID); server-side only, used for conversation history. */
  senderId: string;
  /** Masked sender identifier for display. */
  sender: string;
  /** Linked portal user's name, when the sender is linked. */
  senderName?: string;
  text: string;
  reply?: string;
  status: ChannelEventStatus;
  bookingId?: string;
  /** Tool names the agent called, in order. */
  tools: string[];
  steps: number;
  tokens: number;
  durationMs: number | null;
  at: string; // ISO
  /** Sent from the Settings test console rather than a real webhook. */
  test: boolean;
  /** Outbound leg: whether the reply reached WhatsApp/Slack ("skipped" for test runs). */
  delivery: DeliveryStatus;
  error?: string;
};
