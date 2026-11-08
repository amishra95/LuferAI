-- =============================================================================
-- A company can sign up without its GSTIN, and adds it before its first booking
-- -----------------------------------------------------------------------------
-- Tax invoices, the client's input tax credit, contracts and statements all run
-- on the company's GSTIN, so a booking needs one. Someone trying Lufer out may
-- not have it to hand: they browse venues and ask the concierge for quotes
-- first, and add the GSTIN from company setup or the booking form (server code,
-- service role). Without a GSTIN a signup can't join an existing company, so it
-- opens its own; colleagues are added by invitation (/governance).
-- =============================================================================

alter table public.companies alter column gstin drop not null;

-- The application no longer needs a GSTIN for a company.
alter table public.signup_applications drop constraint if exists signup_applications_enterprise_gstin;

-- No booking for a company without a GSTIN: the invoice would have no recipient.
create or replace function public.bookings_require_company_gstin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only a company the writer can see and that has no GSTIN: anything else (another
  -- tenant under RLS, an unknown id) is left to RLS, the GST trigger and the foreign key.
  if exists (select 1 from public.companies c where c.id = new.company_id and c.gstin is null) then
    raise exception 'Add your company''s GSTIN before booking.' using errcode = 'P0001', hint = 'company_gstin_missing';
  end if;
  return new;
end;
$$;

-- Named to fire before bookings_derive_gst_type (triggers run in name order),
-- which would otherwise fail first with a less helpful message.
drop trigger if exists bookings_company_gstin_required on public.bookings;
create trigger bookings_company_gstin_required
  before insert on public.bookings
  for each row execute function public.bookings_require_company_gstin();
