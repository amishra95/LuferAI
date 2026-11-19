-- What kind of place a partner listing is, for the venue cards and the
-- "Space" filter on /venues. Optional: listings without one still show.

alter table public.partner_venues
  add column if not exists category text;

alter table public.partner_venues
  add constraint partner_venues_category_known
  check (category is null or category in ('hotel', 'fine_dining', 'casual_dining', 'bar'));

-- The Lufer Concierge listings (refs LUF-001..029) as researched when they were added.
update public.partner_venues pv
set category = c.category
from (values
  ('LUF-001', 'hotel'), ('LUF-002', 'hotel'), ('LUF-003', 'hotel'), ('LUF-004', 'hotel'), ('LUF-005', 'hotel'),
  ('LUF-006', 'hotel'), ('LUF-007', 'hotel'), ('LUF-008', 'hotel'), ('LUF-009', 'hotel'), ('LUF-010', 'hotel'),
  ('LUF-011', 'fine_dining'), ('LUF-012', 'fine_dining'), ('LUF-013', 'fine_dining'),
  ('LUF-014', 'casual_dining'), ('LUF-015', 'casual_dining'), ('LUF-016', 'casual_dining'),
  ('LUF-019', 'casual_dining'), ('LUF-021', 'casual_dining'),
  ('LUF-017', 'bar'), ('LUF-018', 'bar'), ('LUF-020', 'bar'), ('LUF-022', 'bar'), ('LUF-023', 'bar'),
  ('LUF-024', 'bar'), ('LUF-025', 'bar'), ('LUF-026', 'bar'), ('LUF-027', 'bar'), ('LUF-028', 'bar'), ('LUF-029', 'bar')
) as c(ref, category)
join public.partners p on p.slug = 'lufer-concierge'
where pv.partner_id = p.id and pv.ref = c.ref and pv.category is null;
