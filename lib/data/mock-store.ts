import "server-only";

import type {
  CatalogItem,
  CatalogOrder,
  Partner,
  ApprovalComment,
  ApprovalChain,
  Booking,
  BookingApproval,
  Company,
  CorporatePolicy,
  CorporateRateCard,
  CorporateRole,
  Department,
  ExpenseExport,
  InventoryHold,
  PlatformUser,
  PoAllocation,
  PurchaseOrder,
  Venue,
  VenueOnboardingRequest,
} from "@/lib/supabase/database.types";
import { determineGstType } from "@/lib/gst-engine";

/**
 * Mirror of supabase/seed.sql, used when Supabase env vars are not set: seeds the
 * Upstash Redis store (lib/data/local-store.ts) once, or backs an in-memory copy
 * when Redis isn't configured either. The in-memory copy lives on globalThis so it
 * survives hot reloads in `next dev`, and resets on restart.
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
    expense_provider: "ramp",
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
    expense_provider: "concur",
    created_at: ts,
    updated_at: ts,
  },
];

/** Venue profile columns (seed.sql "Venue profiles"); every venue has them, most seeds set a few. */
type VenueProfile = Pick<Venue, "min_spend_per_head_inr" | "private_suites" | "seating_layouts" | "serves_alcohol" | "entertainment" | "cancellation_terms">;

export const VENUE_PROFILE_DEFAULTS: VenueProfile = {
  min_spend_per_head_inr: 0,
  private_suites: [],
  seating_layouts: [],
  serves_alcohol: true,
  entertainment: [],
  cancellation_terms: [],
};

const venue = (v: Omit<Venue, "state_code" | "city" | "is_active" | "created_at" | "updated_at" | keyof VenueProfile> & Partial<VenueProfile>): Venue => ({
  ...VENUE_PROFILE_DEFAULTS,
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
    min_spend_per_head_inr: 1500,
    private_suites: [{ name: "The Ember Room", seats: 24, min_spend_inr: 45000 }, { name: "Courtyard Loft", seats: 40, min_spend_inr: 70000 }],
    seating_layouts: [{ layout: "banquet", capacity: 64 }, { layout: "cocktail", capacity: 80 }, { layout: "boardroom", capacity: 20 }],
    entertainment: ["live_music"],
    cancellation_terms: [{ days_before: 14, refund_pct: 100 }, { days_before: 7, refund_pct: 50 }],
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
    min_spend_per_head_inr: 1200,
    seating_layouts: [{ layout: "banquet", capacity: 50 }, { layout: "cocktail", capacity: 70 }],
    entertainment: ["dj"],
    cancellation_terms: [{ days_before: 10, refund_pct: 100 }, { days_before: 3, refund_pct: 25 }],
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
    min_spend_per_head_inr: 1000,
    private_suites: [{ name: "Tile Room", seats: 30, min_spend_inr: 35000 }],
    seating_layouts: [{ layout: "banquet", capacity: 90 }, { layout: "cocktail", capacity: 120 }, { layout: "theatre", capacity: 100 }],
    entertainment: ["live_music", "karaoke", "games"],
    cancellation_terms: [{ days_before: 21, refund_pct: 100 }, { days_before: 7, refund_pct: 50 }],
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
    min_spend_per_head_inr: 1800,
    private_suites: [{ name: "Library", seats: 16, min_spend_inr: 40000 }],
    seating_layouts: [{ layout: "boardroom", capacity: 16 }, { layout: "classroom", capacity: 36 }, { layout: "banquet", capacity: 48 }],
    serves_alcohol: false,
    cancellation_terms: [{ days_before: 7, refund_pct: 100 }],
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
    min_spend_per_head_inr: 3000,
    private_suites: [{ name: "Strongroom", seats: 12, min_spend_inr: 60000 }, { name: "Gallery", seats: 36, min_spend_inr: 150000 }],
    seating_layouts: [{ layout: "banquet", capacity: 60 }, { layout: "cocktail", capacity: 100 }],
    entertainment: ["live_music", "comedy"],
    cancellation_terms: [{ days_before: 30, refund_pct: 100 }, { days_before: 14, refund_pct: 50 }, { days_before: 7, refund_pct: 25 }],
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
    department_id: "dddddddd-0001-4000-8000-000000000001",
    list_budget_per_head_inr: null,
    rate_card_id: null,
    alcohol_included: true,
    entertainment: [],
    settled_at: null,
    expense_reference: null,
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
    department_id: "dddddddd-0004-4000-8000-000000000004",
    list_budget_per_head_inr: null,
    rate_card_id: null,
    alcohol_included: true,
    entertainment: ["live_music"],
    settled_at: null,
    expense_reference: null,
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
    department_id: "dddddddd-0002-4000-8000-000000000002",
    list_budget_per_head_inr: null,
    rate_card_id: null,
    alcohol_included: false,
    entertainment: ["live_music"],
    settled_at: null,
    expense_reference: null,
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
  partner_id: null,
  partner_role: null,
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
    requires_approval_above: 150000, high_value_threshold: 300000, alcohol_policy: "approval", restricted_entertainment: ["dj", "karaoke"],
    created_at: ts, updated_at: ts },
  { id: "eeeeeeee-0002-4000-8000-000000000002", tenant_id: VERTEX, max_budget_per_head: 6000, currency: "INR",
    requires_approval_above: 400000, high_value_threshold: 800000, alcohol_policy: "allowed", restricted_entertainment: [],
    created_at: ts, updated_at: ts },
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

const department = (id: string, company_id: string, name: string, annual_budget_inr: number): Department => ({
  id,
  company_id,
  name,
  annual_budget_inr,
  created_at: ts,
  updated_at: ts,
});

// FY budgets, pre-GST (seed.sql "Departments").
const departments: Department[] = [
  department("dddddddd-0001-4000-8000-000000000001", NIMBUS, "Engineering", 600000),
  department("dddddddd-0002-4000-8000-000000000002", NIMBUS, "Sales", 900000),
  department("dddddddd-0003-4000-8000-000000000003", NIMBUS, "People & Culture", 250000),
  department("dddddddd-0004-4000-8000-000000000004", VERTEX, "Investor Relations", 1500000),
  department("dddddddd-0005-4000-8000-000000000005", VERTEX, "Leadership", 800000),
];

// Blanket POs (seed.sql "Purchase orders"): Nimbus has a company-wide events PO and an
// Engineering one; Vertex an Investor Relations one. Seed bookings draw from them.
const purchaseOrders: PurchaseOrder[] = [
  { id: "70000000-0001-4000-8000-000000000001", tenant_id: NIMBUS, po_number: "NIM-FY27-EVENTS", description: "Company events FY 2026-27",
    department_id: null, amount_inr: 600000, currency: "INR", valid_from: "2026-04-01", valid_to: "2027-03-31", status: "open", created_by: null, created_at: ts, updated_at: ts },
  { id: "70000000-0002-4000-8000-000000000002", tenant_id: NIMBUS, po_number: "NIM-ENG-H2", description: "Engineering offsites, H2",
    department_id: "dddddddd-0001-4000-8000-000000000001", amount_inr: 150000, currency: "INR", valid_from: "2026-07-01", valid_to: "2026-12-31", status: "open", created_by: null, created_at: ts, updated_at: ts },
  { id: "70000000-0003-4000-8000-000000000003", tenant_id: VERTEX, po_number: "VCA-IR-2026", description: "Investor relations hospitality",
    department_id: "dddddddd-0004-4000-8000-000000000004", amount_inr: 500000, currency: "INR", valid_from: "2026-04-01", valid_to: "2027-03-31", status: "open", created_by: null, created_at: ts, updated_at: ts },
];

const poAllocations: PoAllocation[] = [
  { id: "71000000-0001-4000-8000-000000000001", po_id: purchaseOrders[1].id, tenant_id: NIMBUS, booking_id: "bbbbbbbb-0001-4000-8000-000000000001", catalog_order_id: null,
    amount_inr: 100000, status: "committed", over_balance: false, created_at: "2026-09-20T10:00:00.000Z", updated_at: "2026-09-21T10:00:00.000Z" },
  { id: "71000000-0002-4000-8000-000000000002", po_id: purchaseOrders[2].id, tenant_id: VERTEX, booking_id: "bbbbbbbb-0002-4000-8000-000000000002", catalog_order_id: null,
    amount_inr: 120000, status: "consumed", over_balance: false, created_at: "2026-09-02T10:00:00.000Z", updated_at: "2026-09-19T10:00:00.000Z" },
  { id: "71000000-0003-4000-8000-000000000003", po_id: purchaseOrders[0].id, tenant_id: NIMBUS, booking_id: "bbbbbbbb-0003-4000-8000-000000000003", catalog_order_id: null,
    amount_inr: 108000, status: "committed", over_balance: false, created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-01T10:00:00.000Z" },
];

// Catalogue suppliers and items (seed.sql "Catalogue"). GSTINs are synthetic but valid; the
// HSN/SAC codes and rates are illustrative for the demo, not tax advice.
const partners: Partner[] = [
  { id: "80000000-0001-4000-8000-000000000001", name: "Giftwise Hampers", slug: "giftwise", contact_email: "orders@giftwise.example", gstin: "29AAGCG4512K1ZG", status: "active", created_at: ts, updated_at: ts },
  { id: "80000000-0002-4000-8000-000000000002", name: "TixHub Live", slug: "tixhub", contact_email: "corporate@tixhub.example", gstin: "27AAJCT7781M1ZF", status: "active", created_at: ts, updated_at: ts },
  { id: "80000000-0003-4000-8000-000000000003", name: "TeamQuest Experiences", slug: "teamquest", contact_email: "hello@teamquest.example", gstin: "29AAFCT3390Q1ZI", status: "active", created_at: ts, updated_at: ts },
  { id: "80000000-0004-4000-8000-000000000004", name: "Threadline Merch", slug: "threadline", contact_email: "bulk@threadline.example", gstin: "33AAKCT6620P1ZV", status: "active", created_at: ts, updated_at: ts },
];

const item = (i: Omit<CatalogItem, "status" | "created_at" | "updated_at" | "description"> & { description?: string }): CatalogItem => ({
  description: null,
  ...i,
  status: "active",
  created_at: ts,
  updated_at: ts,
});

const catalogItems: CatalogItem[] = [
  item({ id: "81000000-0001-4000-8000-000000000001", partner_id: partners[0].id, category: "gifting", ref: "HAMPER-COFFEE", name: "Artisan coffee & cookie hamper",
    description: "Single-origin Coorg coffee, hand-made cookies and a ceramic mug.", unit_price_inr: 1800, tax_kind: "HSN", tax_code: "2106", gst_rate_percent: 18,
    min_quantity: 5, max_quantity: 500, attributes: { lead_time_days: 5, personalisation: true } }),
  item({ id: "81000000-0002-4000-8000-000000000002", partner_id: partners[0].id, category: "gifting", ref: "HAMPER-WELLNESS", name: "Wellness desk kit",
    unit_price_inr: 1200, tax_kind: "HSN", tax_code: "3307", gst_rate_percent: 18, min_quantity: 10, max_quantity: null, attributes: { lead_time_days: 3 } }),
  item({ id: "81000000-0003-4000-8000-000000000003", partner_id: partners[1].id, category: "tickets", ref: "T20-BLR-CHE", name: "T20 League: Bengaluru vs Chennai",
    unit_price_inr: 1500, tax_kind: "SAC", tax_code: "999692", gst_rate_percent: 18, min_quantity: 2, max_quantity: 50,
    attributes: { event_name: "T20 League: Bengaluru vs Chennai", event_date: "2026-11-29", venue: "M. Chinnaswamy Stadium, Bengaluru", event_state_code: "29",
      tiers: [{ name: "General", price_inr: 1500, available: 200 }, { name: "Pavilion", price_inr: 4500, available: 40 }, { name: "Hospitality box", price_inr: 12000, available: 12 }] } }),
  item({ id: "81000000-0004-4000-8000-000000000004", partner_id: partners[2].id, category: "team_building", ref: "HUNT-BLR", name: "Old Bengaluru treasure hunt",
    description: "Three hours of puzzles across Basavanagudi, with a facilitator per 15 people.", unit_price_inr: 1500, tax_kind: "SAC", tax_code: "998596", gst_rate_percent: 18,
    min_quantity: 15, max_quantity: 120, attributes: { duration_hours: 3, format: "offsite", lead_time_days: 7 } }),
  item({ id: "81000000-0005-4000-8000-000000000005", partner_id: partners[2].id, category: "team_building", ref: "ESCAPE-VIRTUAL", name: "Virtual escape room",
    unit_price_inr: 900, tax_kind: "SAC", tax_code: "998596", gst_rate_percent: 18, min_quantity: 8, max_quantity: 60, attributes: { duration_hours: 1.5, format: "virtual", lead_time_days: 3 } }),
  item({ id: "81000000-0006-4000-8000-000000000006", partner_id: partners[3].id, category: "merch", ref: "TEE-ORGANIC", name: "Organic cotton team tee",
    unit_price_inr: 650, tax_kind: "HSN", tax_code: "6109", gst_rate_percent: 5, min_quantity: 10, max_quantity: null,
    attributes: { sizes: ["S", "M", "L", "XL", "XXL"], lead_time_days: 10, customisable: true } }),
  item({ id: "81000000-0007-4000-8000-000000000007", partner_id: partners[3].id, category: "merch", ref: "BACKPACK", name: "Laptop backpack with logo",
    unit_price_inr: 2200, tax_kind: "HSN", tax_code: "4202", gst_rate_percent: 18, min_quantity: 5, max_quantity: null, attributes: { sizes: ["One size"], lead_time_days: 14, customisable: true } }),
  item({ id: "81000000-0008-4000-8000-000000000008", partner_id: partners[2].id, category: "dining", ref: "CHEFS-TABLE", name: "Chef's table: seven-course tasting",
    unit_price_inr: 3500, tax_kind: "SAC", tax_code: "996331", gst_rate_percent: 5, min_quantity: 8, max_quantity: 24, attributes: { cuisine: "Modern Indian", area: "Indiranagar", lead_time_days: 5 } }),
];

export interface MockDb {
  companies: Company[];
  departments: Department[];
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
  purchaseOrders: PurchaseOrder[];
  poAllocations: PoAllocation[];
  partners: Partner[];
  catalogItems: CatalogItem[];
  catalogOrders: CatalogOrder[];
}

const globalForMock = globalThis as unknown as { __corpHospitalityMockDb?: MockDb };

/** A fresh copy of the seed rows (structuredClone so callers can't mutate the originals). */
export function seedDb(): MockDb {
  return structuredClone({
    companies,
    departments,
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
    purchaseOrders,
    poAllocations,
    partners,
    catalogItems,
    catalogOrders: [],
  });
}

// Spread the existing store last so a hot reload keeps its state but still
// picks up collections added since it was created.
export const mockDb: MockDb = (globalForMock.__corpHospitalityMockDb = {
  companies,
  departments,
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
  purchaseOrders,
  poAllocations,
  partners,
  catalogItems,
  catalogOrders: [],
  ...globalForMock.__corpHospitalityMockDb,
});

/**
 * Fills columns added after a store was seeded (a Redis store seeded before
 * migration 0019, or a hot-reloaded memory copy) with the database defaults.
 * Mutates in place; idempotent.
 */
export function backfillDefaults(db: MockDb): MockDb {
  // Collections added after a Redis store was seeded load as empty.
  db.purchaseOrders ??= [];
  db.poAllocations ??= [];
  db.partners ??= [];
  db.catalogItems ??= [];
  db.catalogOrders ??= [];
  for (const a of db.approvals) a.catalog_order_id ??= null;
  for (const a of db.poAllocations) a.catalog_order_id ??= null;
  for (const e of db.expenseExports) e.catalog_order_id ??= null;
  for (const v of db.venues) for (const [k, d] of Object.entries(VENUE_PROFILE_DEFAULTS)) (v as Record<string, unknown>)[k] ??= structuredClone(d);
  for (const c of db.companies) c.expense_provider ??= "webhook";
  for (const p of db.policies) {
    p.alcohol_policy ??= "allowed";
    p.restricted_entertainment ??= [];
  }
  for (const b of db.bookings) {
    b.alcohol_included ??= false;
    b.entertainment ??= [];
    b.settled_at ??= null;
    b.expense_reference ??= null;
  }
  for (const e of db.expenseExports) {
    e.provider ??= "webhook";
    e.attempts ??= 1;
    e.updated_at ??= e.created_at;
  }
  return db;
}

/** Mock equivalent of the bookings_derive_gst_type trigger (billing GSTIN decides the place of supply when set). */
export function mockGstType(db: MockDb, companyId: string, venueId: string, billingGstin?: string | null) {
  const c = db.companies.find((x) => x.id === companyId);
  const v = db.venues.find((x) => x.id === venueId);
  if (!c || !v) throw new Error("Unknown company or venue");
  return determineGstType(billingGstin || c.gstin, v.gstin);
}
