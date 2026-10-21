/**
 * Validation for the admin's property manager form (app/(dashboard)/admin/managers).
 * Pure (no server imports), so the browser, the server actions and
 * tests/property-delivery.test.mjs share it.
 */

import { normalizePhone } from "../phone.ts";

export { normalizePhone };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ManagerField = "email" | "name" | "phone" | "venue_id";

export interface ManagerInput {
  email: string;
  name: string;
  /** E.164 (+91…), or "" when not given. */
  phone: string;
  venueId: string;
}

export function parseManagerInput(raw: Record<ManagerField, string>): { ok: true; value: ManagerInput } | { ok: false; errors: Partial<Record<ManagerField, string>> } {
  const errors: Partial<Record<ManagerField, string>> = {};
  const email = raw.email.trim().toLowerCase();
  const name = raw.name.trim().replace(/\s+/g, " ");
  const phone = normalizePhone(raw.phone);
  const venueId = raw.venue_id.trim();
  if (!EMAIL.test(email)) errors.email = "Enter a valid email address";
  if (name.length < 2 || name.length > 80) errors.name = "Enter their name (2–80 characters)";
  if (phone === null) errors.phone = "Enter a mobile number, e.g. 98450 12345 or +44 20 7946 0958";
  if (!UUID.test(venueId)) errors.venue_id = "Choose a venue";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { email, name, phone: phone ?? "", venueId } };
}
