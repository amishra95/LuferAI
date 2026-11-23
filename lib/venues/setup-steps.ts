/**
 * What a venue still has to do before companies can book it, in order. Shared by
 * the welcome checklist (/property/welcome) and the dashboard's setup card.
 * `href` is where the venue does it; verification is Lufer's job, so it has none.
 */
export interface SetupStep {
  key: "account" | "gstin" | "package" | "photos" | "minimum" | "verified";
  title: string;
  done: boolean;
  href?: string;
}

export function venueSetupSteps(
  venue: { gstin: string | null; photos: readonly string[]; min_spend_inr: number | string | null; min_spend_per_head_inr: number | string | null; is_active: boolean },
  packages: readonly { is_active: boolean }[]
): SetupStep[] {
  const listing = "/property?tab=pricing";
  return [
    { key: "account", title: "Create your account", done: true },
    // Optional at signup, needed before listing: bookings are invoiced on it.
    { key: "gstin", title: "Add your GSTIN", done: Boolean(venue.gstin), href: "/property/welcome" },
    // A package's per-head price is what companies see on the venue's card and what instant quotes use.
    { key: "package", title: "Add a menu package with a price per head", done: packages.some((p) => p.is_active), href: listing },
    { key: "photos", title: "Add photos", done: venue.photos.length > 0, href: listing },
    { key: "minimum", title: "Set your minimum spend", done: Number(venue.min_spend_inr) > 0 || Number(venue.min_spend_per_head_inr) > 0, href: listing },
    // Verification is ours to do (GSTIN and address, about one working day); the venue only waits.
    { key: "verified", title: venue.is_active ? "Verified" : "Verification in progress", done: venue.is_active },
  ];
}
