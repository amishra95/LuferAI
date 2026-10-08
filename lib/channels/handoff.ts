/**
 * Webhook delivery bookkeeping shared by the WhatsApp and Slack routes. Pure
 * (type-only imports) so tests/channels.test.mjs can exercise it.
 */
import type { ChannelStore } from "./store.ts";

/**
 * Claims a webhook delivery and hands it off once. If the handoff throws, the
 * receipt is released before rethrowing, so the route's 503 leads to a retry
 * that is processed instead of being dropped as a duplicate.
 */
export async function handOff(store: Pick<ChannelStore, "firstDelivery" | "releaseDelivery">, key: string, dispatch: () => Promise<void>) {
  if (!(await store.firstDelivery(key))) return;
  try {
    await dispatch();
  } catch (err) {
    await store.releaseDelivery(key).catch((releaseErr) => console.error(`webhook: could not release receipt ${key}`, releaseErr));
    throw err;
  }
}
