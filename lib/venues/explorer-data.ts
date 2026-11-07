import "server-only";

import type { Member } from "@/lib/auth/session";
import { searchVenuesSpatial } from "@/lib/actions/venue-search";
import { getVenueCatalog, type CatalogVenue } from "@/lib/catalog";
import { getCorporatePolicy, listBookings, listCompanies, listPortalUsers } from "@/lib/data";
import { getUserPhone } from "@/lib/services/contact";
import { MAX_BADGE_KM, officeOf, type OfficeLocation, type VenueCardRules } from "@/lib/venues/discovery";
import { venueRatingMap } from "@/lib/venues/review-store";
import { venueSignals, type VenueSignals } from "@/lib/venues/signals";
import { venueResponseHours } from "@/lib/venues/signals-store";

/** Everything the bookable venue explorer (cards, policy fit, distance, request form) needs. */
export interface VenueExplorerData {
  venues: CatalogVenue[];
  company: { id: string; gstin: string };
  departments: { id: string; name: string }[];
  defaultPhone?: string;
  policy: VenueCardRules | null;
  office: OfficeLocation | null;
  officeDistances: Record<string, number> | null;
  signals: Record<string, VenueSignals>;
}

/**
 * The explorer for an employee who can request (Organizer or Approver) at
 * their own company; null for anyone else (finance viewers, admins, other
 * portals), who get the plain directory.
 */
export async function loadVenueExplorer(member: Member | null): Promise<VenueExplorerData | null> {
  if (member?.role !== "CLIENT" || !member.companyId) return null;
  const companyId = member.companyId;
  const [companies, users] = await Promise.all([listCompanies(), listPortalUsers({ companyId })]);
  const company = companies.find((c) => c.id === companyId);
  const role = users.find((u) => u.id === member.userId)?.role;
  if (!company || (role !== "ORGANIZER" && role !== "APPROVER")) return null;

  const office = officeOf(company);
  const [catalog, policy, bookings, responseHours, ratings, nearby, phone] = await Promise.all([
    getVenueCatalog(companyId),
    getCorporatePolicy(companyId),
    listBookings({ companyId }),
    venueResponseHours(),
    venueRatingMap(),
    office ? searchVenuesSpatial({ ...office, radiusMeters: MAX_BADGE_KM * 1000 }) : Promise.resolve(null),
    getUserPhone(member.userId),
  ]);
  return {
    venues: catalog.venues,
    company: { id: company.id, gstin: company.gstin },
    departments: catalog.departments,
    defaultPhone: phone ?? undefined,
    policy: policy && {
      max_budget_per_head: policy.max_budget_per_head,
      requires_approval_above: policy.requires_approval_above,
      high_value_threshold: policy.high_value_threshold,
      auto_approval_limit_per_head: policy.auto_approval_limit_per_head,
      manager_approval_limit_per_head: policy.manager_approval_limit_per_head,
      max_office_distance_km: policy.max_office_distance_km,
    },
    office,
    officeDistances: nearby ? Object.fromEntries(nearby.venues.map((v) => [v.id, v.distanceMeters])) : null,
    signals: Object.fromEntries(venueSignals(bookings, member.userId, { responseHours, ratings })),
  };
}
