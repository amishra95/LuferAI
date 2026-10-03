-- =============================================================================
-- Seed data · corp-hospitality-platform
-- -----------------------------------------------------------------------------
-- All GSTINs below are synthetic but structurally valid (correct state code,
-- PAN shape and checksum digit), so they pass public.is_valid_gstin().
-- Fixed UUIDs make the rows easy to reference from tests and the UI mock layer
-- (lib/mock-data.ts mirrors this file).
-- =============================================================================

-- Companies ---------------------------------------------------------------------
insert into public.companies (id, legal_name, gstin, primary_contact_email, monthly_spend_limit_inr) values
  -- Karnataka (29) → intra-state with Bengaluru venues → CGST + SGST
  ('11111111-1111-4111-8111-111111111111', 'Nimbus Analytics Private Limited',
   '29AABCN4821K1ZA', 'events@nimbusanalytics.example', 500000.00),
  -- Delhi (07) → inter-state with Bengaluru venues → IGST
  ('22222222-2222-4222-8222-222222222222', 'Vertex Capital Advisors Private Limited',
   '07AAECV6730M1ZX', 'ea.office@vertexcapital.example', 1200000.00);

-- Venues (all Bengaluru, Karnataka → state code 29) -------------------------------
insert into public.venues
  (id, name, city, neighborhood, address, gstin, pdr_available, capacity_max, min_spend_inr, commission_rate) values
  ('aaaaaaaa-0001-4000-8000-000000000001', 'The Copper Courtyard', 'Bengaluru', 'Indiranagar',
   '12th Main Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038',
   '29AADCC1904P1ZF', true, 80, 75000.00, 0.15),
  ('aaaaaaaa-0002-4000-8000-000000000002', 'Saffron Terrace', 'Bengaluru', 'Indiranagar',
   '100 Feet Road, Indiranagar, Bengaluru 560038',
   '29AAFCS5517Q1ZM', false, 120, 50000.00, 0.15),
  ('aaaaaaaa-0003-4000-8000-000000000003', 'Mosaic Kitchen & Bar', 'Bengaluru', 'Koramangala',
   '80 Feet Road, 4th Block, Koramangala, Bengaluru 560034',
   '29AAGCM3382R1ZM', true, 150, 60000.00, 0.12),
  ('aaaaaaaa-0004-4000-8000-000000000004', 'Indigo House', 'Bengaluru', 'Koramangala',
   '5th Block, Koramangala, Bengaluru 560095',
   '29AAHCI7045T1ZL', true, 60, 40000.00, 0.15),
  ('aaaaaaaa-0005-4000-8000-000000000005', 'The Vault at UB City', 'Bengaluru', 'UB City',
   'Level 3, UB City, Vittal Mallya Road, Bengaluru 560001',
   '29AAJCV2268L1ZN', true, 200, 100000.00, 0.18);

-- Bookings ----------------------------------------------------------------------
-- total_amount_inr is the pre-GST taxable value. gst_type is derived by trigger;
-- the expected outcome is noted against each row.
insert into public.bookings
  (id, company_id, venue_id, party_size, budget_per_head_inr, total_amount_inr, status, event_date, notes) values
  -- #1 Intra-state: Karnataka company × Karnataka venue → CGST 9% (₹9,000) + SGST 9% (₹9,000)
  ('bbbbbbbb-0001-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0001-4000-8000-000000000001',
   40, 2500.00, 100000.00, 'CONFIRMED', '2026-10-16', 'Q3 engineering offsite dinner, PDR required'),
  -- #2 Inter-state: Delhi company × Karnataka venue → IGST 18% (₹21,600)
  ('bbbbbbbb-0002-4000-8000-000000000002',
   '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0005-4000-8000-000000000005',
   30, 4000.00, 120000.00, 'COMPLETED', '2026-09-18', 'Bengaluru LP roadshow cocktail evening'),
  -- #3 Intra-state: Karnataka company × Karnataka venue → CGST 9% (₹9,720) + SGST 9% (₹9,720)
  ('bbbbbbbb-0003-4000-8000-000000000003',
   '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0003-4000-8000-000000000003',
   60, 1800.00, 108000.00, 'PENDING', '2026-11-06', 'Annual sales kickoff, live music preferred');

-- Venue onboarding queue (Admin portal) -------------------------------------------
insert into public.venue_onboarding_requests
  (venue_name, city, neighborhood, gstin, contact_name, contact_email, capacity_max, pdr_available, proposed_commission_rate, status, submitted_at) values
  ('Banyan Grill', 'Bengaluru', 'Whitefield', '29AAKCB9031H1ZG',
   'Arjun Rao', 'gm@banyangrill.example', 90, true, 0.15, 'UNDER_REVIEW', now() - interval '3 days'),
  ('Harbour Loft', 'Mumbai', 'Lower Parel', '27AALCH4410D1ZW',
   'Meera Shah', 'partnerships@harbourloft.example', 140, true, 0.14, 'SUBMITTED', now() - interval '1 day'),
  ('Ragi & Rye', 'Bengaluru', 'Jayanagar', '29AAMCR6625G1ZY',
   'Kiran Hegde', 'owner@ragiandrye.example', 45, false, 0.15, 'SUBMITTED', now() - interval '6 hours');
