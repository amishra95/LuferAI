import "server-only";

import type { Booking, Company, Venue, VenueOnboardingRequest } from "@/lib/supabase/database.types";
import { determineGstType } from "@/lib/gst-engine";

/**
 * In-memory mirror of supabase/seed.sql, used when Supabase env vars are not set.
 * Lives on globalThis so it survives hot reloads in `next dev`. Resets on restart.
 */

const ts = "2026-09-01T09:00:00.000Z";

const companies: Company[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    legal_name: "Nimbus Analytics Private Limited",
    gstin: "29AABCN4821K1ZA",
    state_code: "29",
    primary_contact_email: "events@nimbusanalytics.example",
    monthly_spend_limit_inr: 500000,
    created_at: ts,
    updated_at: ts,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    legal_name: "Vertex Capital Advisors Private Limited",
    gstin: "07AAECV6730M1ZX",
    state_code: "07",
    primary_contact_email: "ea.office@vertexcapital.example",
    monthly_spend_limit_inr: 1200000,
    created_at: ts,
    updated_at: ts,
  },
];

const venue = (v: Omit<Venue, "state_code" | "city" | "is_active" | "created_at" | "updated_at">): Venue => ({
  ...v,
  city: "Bengaluru",
  state_code: v.gstin.slice(0, 2),
  is_active: true,
  created_at: ts,
  updated_at: ts,
});

const venues: Venue[] = [
  venue({
    id: "aaaaaaaa-0001-4000-8000-000000000001",
    name: "The Copper Courtyard",
    neighborhood: "Indiranagar",
    address: "12th Main Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038",
    gstin: "29AADCC1904P1ZF",
    pdr_available: true,
    capacity_max: 80,
    min_spend_inr: 75000,
    commission_rate: 0.15,
  }),
  venue({
    id: "aaaaaaaa-0002-4000-8000-000000000002",
    name: "Saffron Terrace",
    neighborhood: "Indiranagar",
    address: "100 Feet Road, Indiranagar, Bengaluru 560038",
    gstin: "29AAFCS5517Q1ZM",
    pdr_available: false,
    capacity_max: 120,
    min_spend_inr: 50000,
    commission_rate: 0.15,
  }),
  venue({
    id: "aaaaaaaa-0003-4000-8000-000000000003",
    name: "Mosaic Kitchen & Bar",
    neighborhood: "Koramangala",
    address: "80 Feet Road, 4th Block, Koramangala, Bengaluru 560034",
    gstin: "29AAGCM3382R1ZM",
    pdr_available: true,
    capacity_max: 150,
    min_spend_inr: 60000,
    commission_rate: 0.12,
  }),
  venue({
    id: "aaaaaaaa-0004-4000-8000-000000000004",
    name: "Indigo House",
    neighborhood: "Koramangala",
    address: "5th Block, Koramangala, Bengaluru 560095",
    gstin: "29AAHCI7045T1ZL",
    pdr_available: true,
    capacity_max: 60,
    min_spend_inr: 40000,
    commission_rate: 0.15,
  }),
  venue({
    id: "aaaaaaaa-0005-4000-8000-000000000005",
    name: "The Vault at UB City",
    neighborhood: "UB City",
    address: "Level 3, UB City, Vittal Mallya Road, Bengaluru 560001",
    gstin: "29AAJCV2268L1ZN",
    pdr_available: true,
    capacity_max: 200,
    min_spend_inr: 100000,
    commission_rate: 0.18,
  }),
];

const bookings: Booking[] = [
  {
    id: "bbbbbbbb-0001-4000-8000-000000000001",
    company_id: companies[0].id,
    venue_id: venues[0].id,
    party_size: 40,
    budget_per_head_inr: 2500,
    total_amount_inr: 100000,
    sac_code: "998596",
    gst_type: "CGST_SGST",
    status: "CONFIRMED",
    event_date: "2026-10-16",
    notes: "Q3 engineering offsite dinner, PDR required",
    created_at: "2026-09-20T10:00:00.000Z",
    updated_at: "2026-09-21T10:00:00.000Z",
  },
  {
    id: "bbbbbbbb-0002-4000-8000-000000000002",
    company_id: companies[1].id,
    venue_id: venues[4].id,
    party_size: 30,
    budget_per_head_inr: 4000,
    total_amount_inr: 120000,
    sac_code: "998596",
    gst_type: "IGST",
    status: "COMPLETED",
    event_date: "2026-09-18",
    notes: "Bengaluru LP roadshow cocktail evening",
    created_at: "2026-09-02T10:00:00.000Z",
    updated_at: "2026-09-19T10:00:00.000Z",
  },
  {
    id: "bbbbbbbb-0003-4000-8000-000000000003",
    company_id: companies[0].id,
    venue_id: venues[2].id,
    party_size: 60,
    budget_per_head_inr: 1800,
    total_amount_inr: 108000,
    sac_code: "998596",
    gst_type: "CGST_SGST",
    status: "PENDING",
    event_date: "2026-11-06",
    notes: "Annual sales kickoff, live music preferred",
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
  },
];

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const onboarding: VenueOnboardingRequest[] = [
  {
    id: "cccccccc-0001-4000-8000-000000000001",
    venue_name: "Banyan Grill",
    city: "Bengaluru",
    neighborhood: "Whitefield",
    gstin: "29AAKCB9031H1ZG",
    contact_name: "Arjun Rao",
    contact_email: "gm@banyangrill.example",
    capacity_max: 90,
    pdr_available: true,
    proposed_commission_rate: 0.15,
    status: "UNDER_REVIEW",
    venue_id: null,
    submitted_at: hoursAgo(72),
    reviewed_at: null,
  },
  {
    id: "cccccccc-0002-4000-8000-000000000002",
    venue_name: "Harbour Loft",
    city: "Mumbai",
    neighborhood: "Lower Parel",
    gstin: "27AALCH4410D1ZW",
    contact_name: "Meera Shah",
    contact_email: "partnerships@harbourloft.example",
    capacity_max: 140,
    pdr_available: true,
    proposed_commission_rate: 0.14,
    status: "SUBMITTED",
    venue_id: null,
    submitted_at: hoursAgo(24),
    reviewed_at: null,
  },
  {
    id: "cccccccc-0003-4000-8000-000000000003",
    venue_name: "Ragi & Rye",
    city: "Bengaluru",
    neighborhood: "Jayanagar",
    gstin: "29AAMCR6625G1ZY",
    contact_name: "Kiran Hegde",
    contact_email: "owner@ragiandrye.example",
    capacity_max: 45,
    pdr_available: false,
    proposed_commission_rate: 0.15,
    status: "SUBMITTED",
    venue_id: null,
    submitted_at: hoursAgo(6),
    reviewed_at: null,
  },
];

interface MockDb {
  companies: Company[];
  venues: Venue[];
  bookings: Booking[];
  onboarding: VenueOnboardingRequest[];
}

const globalForMock = globalThis as unknown as { __corpHospitalityMockDb?: MockDb };

export const mockDb: MockDb = (globalForMock.__corpHospitalityMockDb ??= {
  companies,
  venues,
  bookings,
  onboarding,
});

/** Mock equivalent of the bookings_derive_gst_type trigger. */
export function mockGstType(companyId: string, venueId: string) {
  const c = mockDb.companies.find((x) => x.id === companyId);
  const v = mockDb.venues.find((x) => x.id === venueId);
  if (!c || !v) throw new Error("Unknown company or venue");
  return determineGstType(c.gstin, v.gstin);
}
