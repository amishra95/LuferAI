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

-- Corporate rate cards (tenant × venue) ------------------------------------------------
-- Nimbus: 15% off at The Copper Courtyard; a fixed ₹1,600/head at Mosaic with a
-- lower ₹50k minimum spend. Priced in the app (lib/rates) when a booking is made.
insert into public.corporate_rate_cards
  (tenant_id, venue_id, discount_percentage, custom_per_head_rate, minimum_spend_override, effective_from) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0001-4000-8000-000000000001', 15.00, null,    null,     '2026-01-01'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0003-4000-8000-000000000003',  0.00, 1600.00, 50000.00, '2026-01-01');

-- Menu packages ----------------------------------------------------------------------
insert into public.venue_menu_packages (venue_id, name, per_head_inr, dietary_tags, description) values
  ('aaaaaaaa-0001-4000-8000-000000000001', 'Courtyard Classic',   2200.00, '{vegetarian}',                'Four-course North Indian set menu'),
  ('aaaaaaaa-0001-4000-8000-000000000001', 'Copper Grill',        2900.00, '{halal}',                     'Tandoor grills with mocktail pairing'),
  ('aaaaaaaa-0002-4000-8000-000000000002', 'Terrace Thali',       1500.00, '{vegetarian,jain}',           'Rajasthani thali, Jain on request'),
  ('aaaaaaaa-0003-4000-8000-000000000003', 'Mosaic Small Plates', 1700.00, '{vegetarian,vegan,gluten_free}', 'Pan-Asian sharing plates'),
  ('aaaaaaaa-0003-4000-8000-000000000003', 'Mosaic Feast',        2400.00, '{halal}',                     'Live grill counter and dessert bar'),
  ('aaaaaaaa-0004-4000-8000-000000000004', 'Indigo Coastal',      1900.00, '{gluten_free}',               'Mangalorean seafood set'),
  ('aaaaaaaa-0005-4000-8000-000000000005', 'Vault Signature',     4200.00, '{vegetarian,vegan,halal,jain}', 'Chef''s tasting menu, all diets catered');

-- Venue coordinates (client map) ----------------------------------------------------------
update public.venues v set latitude = c.lat, longitude = c.lng
from (values
  ('aaaaaaaa-0001-4000-8000-000000000001'::uuid, 12.971900, 77.641100),  -- Indiranagar, 12th Main
  ('aaaaaaaa-0002-4000-8000-000000000002'::uuid, 12.978400, 77.640800),  -- Indiranagar, 100 Feet Rd
  ('aaaaaaaa-0003-4000-8000-000000000003'::uuid, 12.934500, 77.626600),  -- Koramangala 4th Block
  ('aaaaaaaa-0004-4000-8000-000000000004'::uuid, 12.935200, 77.614400),  -- Koramangala 5th Block
  ('aaaaaaaa-0005-4000-8000-000000000005'::uuid, 12.971600, 77.596100)   -- UB City
) as c(id, lat, lng)
where v.id = c.id;

-- Corporate policies --------------------------------------------------------------------
-- Nimbus: ₹2,500/head cap, sign-off above ₹1.5L. Vertex: ₹4,500/head, no threshold.
-- Approvers (approval_chains) reference auth users, so they're set up per environment.
insert into public.corporate_policies (tenant_id, max_budget_per_head, requires_approval_above) values
  ('11111111-1111-4111-8111-111111111111', 2500.00, 150000.00),
  ('22222222-2222-4222-8222-222222222222', 4500.00, null);

-- Departments (FY budgets, pre-GST) ---------------------------------------------------------
insert into public.departments (id, company_id, name, annual_budget_inr) values
  ('dddddddd-0001-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Engineering',     600000.00),
  ('dddddddd-0002-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Sales',           900000.00),
  ('dddddddd-0003-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'People & Culture', 250000.00),
  ('dddddddd-0004-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Investor Relations', 1500000.00),
  ('dddddddd-0005-4000-8000-000000000005', '22222222-2222-4222-8222-222222222222', 'Leadership',     800000.00);

update public.bookings set department_id = 'dddddddd-0001-4000-8000-000000000001' where id = 'bbbbbbbb-0001-4000-8000-000000000001';
update public.bookings set department_id = 'dddddddd-0004-4000-8000-000000000004' where id = 'bbbbbbbb-0002-4000-8000-000000000002';
update public.bookings set department_id = 'dddddddd-0002-4000-8000-000000000002' where id = 'bbbbbbbb-0003-4000-8000-000000000003';

-- The pending seed booking holds its venue/date (24h hold, 6h already elapsed).
insert into public.inventory_holds (venue_id, tenant_id, booking_id, hold_start, hold_expires_at)
values ('aaaaaaaa-0003-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
        'bbbbbbbb-0003-4000-8000-000000000003', now() - interval '6 hours', now() + interval '18 hours');
