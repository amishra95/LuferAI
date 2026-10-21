/**
 * Links into the workspace chat (/chat) from the portals. The company and a
 * draft prompt travel as query params: the chat shows the company and puts the
 * draft in the composer, unsent. Context only: /api/chat still scopes every
 * tool to the signed-in member, so ?company never widens what a user can see.
 */

/** Longest draft accepted from a URL; anything longer is cut. */
export const MAX_DRAFT_LENGTH = 500;

export function conciergeHref({ companyId, prompt }: { companyId?: string | null; prompt?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (companyId) q.set("company", companyId);
  const draft = prompt?.trim();
  if (draft) q.set("prompt", draft.slice(0, MAX_DRAFT_LENGTH));
  return q.size ? `/chat?${q}` : "/chat";
}

/** The draft from `?prompt=`: a single trimmed string, capped, or "" when absent. */
export function draftFromParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, MAX_DRAFT_LENGTH);
}

/** Pre-filled brief behind "Request team event": the concierge fills the blanks by asking. */
export function teamEventPrompt(companyName: string): string {
  return `Plan a team event for ${companyName}: [occasion], about [number] guests in [city / area] on [date], budget around ₹[amount] per head. Suggest venues within our policy.`;
}

/** Pre-filled brief behind a venue's "Request event" / "Request RFP" actions. */
export function venueEventPrompt(venue: { name: string; neighborhood?: string | null; city?: string | null }, kind: "event" | "rfp" = "event"): string {
  const where = [venue.neighborhood, venue.city].filter(Boolean).join(", ");
  const at = `${venue.name}${where ? ` (${where})` : ""}`;
  return kind === "rfp"
    ? `I want to send an RFP for a corporate event to ${at}. Please help me structure it with date, guest count, and budget.`
    : `I want to request a corporate event at ${at}. Please help me structure the request with date, guest count, and budget.`;
}
