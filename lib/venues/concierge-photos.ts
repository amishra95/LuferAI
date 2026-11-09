/*
 * Photos for the Lufer Concierge listings (partner_venues under the "Lufer
 * Concierge" partner, refs LUF-001…), taken from each venue's own website and
 * used with the venue's permission. Self-hosted in public/venues/concierge so
 * the cards don't depend on (or hotlink) the venues' sites.
 *
 * To add one: save the image as public/venues/concierge/<REF>.jpg (landscape,
 * about 1200px wide, no text or logos baked in), then add a line below with the
 * page it came from. Listings without an entry show no photo.
 */

export const CONCIERGE_PARTNER = "Lufer Concierge";

const PHOTOS: Record<string, { source: string }> = {
  "LUF-001": { source: "https://www.oberoihotels.com/hotels-in-bangalore/" }, // The Oberoi, Bengaluru
  "LUF-002": { source: "https://www.ritzcarlton.com/en/hotels/blrrz-the-ritz-carlton-bangalore/overview/" }, // The Ritz-Carlton, Bengaluru
  "LUF-003": { source: "https://www.theleela.com/the-leela-palace-bengaluru" }, // The Leela Palace Bengaluru
  "LUF-017": { source: "https://windmillscraftworks.com/" }, // Windmills Craftworks
  "LUF-023": { source: "https://toit.in/" }, // Toit
  "LUF-027": { source: "https://arborbrewing.in/" }, // Arbor Brewing Company
};

/** The listing's photo URL, or null when the concierge has none for it (or it isn't a concierge listing). */
export function conciergePhotoUrl(partnerName: string, ref: string): string | null {
  if (partnerName !== CONCIERGE_PARTNER || !(ref in PHOTOS)) return null;
  return `/venues/concierge/${ref}.jpg`;
}

/** Refs with a photo on file (tests and the admin view). */
export const conciergePhotoRefs = (): string[] => Object.keys(PHOTOS);
