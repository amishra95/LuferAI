import "server-only";

import type {
  ApprovalComment,
  ApprovalChain,
  Booking,
  BookingApproval,
  Company,
  CorporatePolicy,
  CorporateRateCard,
  CorporateRole,
  ExpenseExport,
  InventoryHold,
  PlatformUser,
  Venue,
  VenueOnboardingRequest,
} from "@/lib/supabase/database.types";
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
    latitude: 12.9719,
    longitude: 77.6411,
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
    latitude: 12.9784,
    longitude: 77.6408,
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
    latitude: 12.9345,
    longitude: 77.6266,
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
    latitude: 12.9352,
    longitude: 77.6144,
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
    latitude: 12.9716,
    longitude: 77.5961,
  }),
];

const bookings: Booking[] = [
  {
    id: "bbbbbbbb-0001-4000-8000-000000000001",
    cost_center: "ENG-BLR",
    project_code: "Q3-OFFSITE",
    billing_gstin: null,
    company_id: companies[0].id,
    venue_id: venues[0].id,
    party_size: 40,
    budget_per_head_inr: 2500,
    total_amount_inr: 100000,
    sac_code: "998596",
    gst_type: "CGST_SGST",
    commission_rate: venues[0].commission_rate,
    department_id: null,
    list_budget_per_head_inr: null,
    rate_card_id: null,
    status: "CONFIRMED",
    event_date: "2026-10-16",
    notes: "Q3 engineering offsite dinner, PDR required",
    created_at: "2026-09-20T10:00:00.000Z",
    updated_at: "2026-09-21T10:00:00.000Z",
  },
  {
    id: "bbbbbbbb-0002-4000-8000-000000000002",
    cost_center: "IR-ROADSHOW",
    project_code: null,
    billing_gstin: null,
    company_id: companies[1].id,
    venue_id: venues[4].id,
    party_size: 30,
    budget_per_head_inr: 4000,
    total_amount_inr: 120000,
    sac_code: "998596",
    gst_type: "IGST",
    commission_rate: venues[4].commission_rate,
    department_id: null,
    list_budget_per_head_inr: null,
    rate_card_id: null,
    status: "COMPLETED",
    event_date: "2026-09-18",
    notes: "Bengaluru LP roadshow cocktail evening",
    created_at: "2026-09-02T10:00:00.000Z",
    updated_at: "2026-09-19T10:00:00.000Z",
  },
  {
    id: "bbbbbbbb-0003-4000-8000-000000000003",
    cost_center: "SALES-SKO",
    project_code: "FY27-SKO",
    billing_gstin: null,
    company_id: companies[0].id,
    venue_id: venues[2].id,
    party_size: 60,
    budget_per_head_inr: 1800,
    total_amount_inr: 108000,
    sac_code: "998596",
    gst_type: "CGST_SGST",
    commission_rate: venues[2].commission_rate,
    department_id: null,
    list_budget_per_head_inr: null,
    rate_card_id: null,
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

// Corporate approval workflow demo data (no mirror in seed.sql: platform_users
// needs real auth.users rows, so Supabase setups create these via the dashboard).
const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";

/** platform_users plus a display name, which in Supabase comes from auth.users. */
export type MockPortalUser = PlatformUser & { name: string };

const portalUser = (user_id: string, company_id: string, name: string, corporate_role: CorporateRole): MockPortalUser => ({
  user_id,
  role: "CLIENT",
  company_id,
  venue_id: null,
  corporate_role,
  created_at: ts,
  name,
});

const users: MockPortalUser[] = [
  portalUser("dddddddd-0001-4000-8000-000000000001", NIMBUS, "Priya Raman (Executive Assistant)", "ORGANIZER"),
  portalUser("dddddddd-0002-4000-8000-000000000002", NIMBUS, "Arjun Mehta (Finance Manager)", "APPROVER"),
  portalUser("dddddddd-0003-4000-8000-000000000003", VERTEX, "Neha Kapoor (Office Manager)", "ORGANIZER"),
  portalUser("dddddddd-0004-4000-8000-000000000004", VERTEX, "Rohan Iyer (Managing Director)", "APPROVER"),
  portalUser("dddddddd-0005-4000-8000-000000000005", NIMBUS, "Vikram Shah (VP Operations)", "APPROVER"),
  portalUser("dddddddd-0006-4000-8000-000000000006", NIMBUS, "Kavya Nair (Finance Controller)", "FINANCE_VIEWER"),
  portalUser("dddddddd-0007-4000-8000-000000000007", VERTEX, "Ananya Rao (CFO)", "APPROVER"),
  portalUser("dddddddd-0008-4000-8000-000000000008", VERTEX, "Sameer Das (Accounts)", "FINANCE_VIEWER"),
];

const policies: CorporatePolicy[] = [
  { id: "eeeeeeee-0001-4000-8000-000000000001", tenant_id: NIMBUS, max_budget_per_head: 3000, currency: "INR",
    requires_approval_above: 150000, high_value_threshold: 300000, created_at: ts, updated_at: ts },
  { id: "eeeeeeee-0002-4000-8000-000000000002", tenant_id: VERTEX, max_budget_per_head: 6000, currency: "INR",
    requires_approval_above: 400000, high_value_threshold: 800000, created_at: ts, updated_at: ts },
];

const approvalChains: ApprovalChain[] = [
  { id: "ffffffff-0001-4000-8000-000000000001", tenant_id: NIMBUS, approver_user_id: users[1].user_id, tier_level: 1, created_at: ts },
  { id: "ffffffff-0002-4000-8000-000000000002", tenant_id: VERTEX, approver_user_id: users[3].user_id, tier_level: 1, created_at: ts },
  // Tier 2: senior sign-off for bookings above the high-value threshold.
  { id: "ffffffff-0003-4000-8000-000000000003", tenant_id: NIMBUS, approver_user_id: users[4].user_id, tier_level: 2, created_at: ts },
  { id: "ffffffff-0004-4000-8000-000000000004", tenant_id: VERTEX, approver_user_id: users[6].user_id, tier_level: 2, created_at: ts },
];

// Demo negotiated terms: Nimbus gets 12% off at The Copper Courtyard, open-ended.
const rateCards: CorporateRateCard[] = [
  { id: "99999999-0001-4000-8000-000000000001", tenant_id: NIMBUS, venue_id: "aaaaaaaa-0001-4000-8000-000000000001",
    discount_percentage: 12, custom_per_head_rate: null, minimum_spend_override: null,
    effective_from: "2026-01-01", effective_to: null, created_at: ts, updated_at: ts },
];

interface MockDb {
  companies: Company[];
  venues: Venue[];
  bookings: Booking[];
  onboarding: VenueOnboardingRequest[];
  users: MockPortalUser[];
  policies: CorporatePolicy[];
  approvalChains: ApprovalChain[];
  approvals: BookingApproval[];
  approvalComments: ApprovalComment[];
  holds: InventoryHold[];
  rateCards: CorporateRateCard[];
  expenseExports: ExpenseExport[];
}

const globalForMock = globalThis as unknown as { __corpHospitalityMockDb?: MockDb };

// Spread the existing store last so a hot reload keeps its state but still
// picks up collections added since it was created.
export const mockDb: MockDb = (globalForMock.__corpHospitalityMockDb = {
  companies,
  venues,
  bookings,
  onboarding,
  users,
  policies,
  approvalChains,
  approvals: [],
  approvalComments: [],
  holds: [],
  rateCards,
  expenseExports: [],
  ...globalForMock.__corpHospitalityMockDb,
});

/** Mock equivalent of the bookings_derive_gst_type trigger (billing GSTIN decides the place of supply when set). */
export function mockGstType(companyId: string, venueId: string, billingGstin?: string | null) {
  const c = mockDb.companies.find((x) => x.id === companyId);
  const v = mockDb.venues.find((x) => x.id === venueId);
  if (!c || !v) throw new Error("Unknown company or venue");
  return determineGstType(billingGstin || c.gstin, v.gstin);
}
