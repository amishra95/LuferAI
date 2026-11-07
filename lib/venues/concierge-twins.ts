/**
 * Concierge listings are venues Lufer arranges by hand (partner "Lufer
 * Concierge", Wizard of Oz). When the real venue joins and goes live, its
 * listing must step aside, or companies see it twice. Pure: tests import it.
 */

export const CONCIERGE_PARTNER_SLUG = "lufer-concierge";

const STOP = new Set(["the", "bengaluru", "bangalore", "blr", "restaurant", "bar", "and", "co", "company"]);

/** "The Fatty Bao (Indiranagar)" → "fatty bao"; "Bob’s Bar" → "bobs". */
export function venueKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .join(" ");
}

const areaKey = (area: string) => area.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Listings that are the same place as `venue`: same name, and the same area when the listing names one. */
export function conciergeTwins<L extends { id: string; name: string; area: string }>(venue: { name: string; neighborhood: string }, listings: readonly L[]): L[] {
  const key = venueKey(venue.name);
  if (!key) return [];
  const area = areaKey(venue.neighborhood);
  return listings.filter((l) => {
    if (venueKey(l.name) !== key) return false;
    const la = areaKey(l.area);
    // Chains list one outlet per area: only the outlet in the same area is the same place.
    return !la || !area || la.includes(area) || area.includes(la);
  });
}
