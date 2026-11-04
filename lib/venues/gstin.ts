/**
 * A venue may sign up without its GSTIN, but it can't be listed until it adds
 * one (venues_listed_have_gstin in the database). Anything that books, invoices
 * or contracts a venue therefore has one; this says so, and fails loudly if not.
 */
export function listedGstin(venue: { name: string; gstin: string | null }): string {
  if (!venue.gstin) throw new Error(`${venue.name} has no GSTIN yet, so it can't be booked or invoiced.`);
  return venue.gstin;
}
