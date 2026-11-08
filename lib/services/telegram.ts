import "server-only";

import type { NotifyOutcome } from "@/lib/services/notifications";

/**
 * A message to Lufer's own Telegram chat (the concierge's instant alerts).
 * Skipped unless TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID are
 * set. Plain text, no parse mode, so user input can't break formatting.
 * Never throws; gives up after 5 s so a slow API never holds a request.
 */
export async function sendTelegram(text: string): Promise<NotifyOutcome> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return { status: "skipped", reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { status: "failed", error: `Telegram ${res.status}` };
    return { status: "sent", to: "telegram" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
