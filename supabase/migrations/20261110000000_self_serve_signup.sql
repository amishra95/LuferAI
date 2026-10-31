-- =============================================================================
-- Self-serve signup: instant access, and venue owners can sign up
-- -----------------------------------------------------------------------------
-- Until now every /signup application waited for a platform admin. Now the
-- app activates it as soon as the applicant's email is verified
-- (activate_signup_application), unless it needs a human:
--   enterprise  whose GSTIN is already a customer: joining someone else's
--               company stays with an admin, as before
--   venue       whose GSTIN is already a listed venue: same
--
-- A third account type, 'venue', is a venue owner or manager. Activating one
-- creates their venue unlisted (is_active = false) and a PROPERTY membership:
-- they can set it up straight away, and an admin publishes it once verified.
-- Venue managers could always update their own venue row; they now can't
-- change the columns only an admin may (listing, commission, GSTIN).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Applications: the venue account type and its details
-- -----------------------------------------------------------------------------

alter table public.signup_applications
  add column if not exists venue_area     text check (venue_area is null or char_length(btrim(venue_area)) between 2 and 80),
  add column if not exists venue_address  text check (venue_address is null or char_length(btrim(venue_address)) between 5 and 300),
  add column if not exists venue_capacity integer check (venue_capacity is null or venue_capacity between 1 and 100000),
  -- Set on activation: the venue the applicant manages.
  add column if not exists venue_id       uuid references public.venues (id) on delete set null;

alter table public.signup_applications drop constraint if exists signup_applications_account_type_check;
alter table public.signup_applications add constraint signup_applications_account_type_check
  check (account_type in ('enterprise', 'partner', 'venue'));

-- A venue is invoiced and listed on its GSTIN, and needs where it is and how many it seats.
alter table public.signup_applications drop constraint if exists signup_applications_venue_details;
alter table public.signup_applications add constraint signup_applications_venue_details check (
  account_type <> 'venue'
  or (gstin is not null and city is not null and venue_area is not null and venue_address is not null and venue_capacity is not null)
);

comment on table public.signup_applications is
  'Self-service signups (enterprise, partner or venue). Activated on email verification unless an admin must decide; service role writes only.';

-- -----------------------------------------------------------------------------
-- Deciding an application: now also venues; p_reviewer is null when self-serve
-- -----------------------------------------------------------------------------

create or replace function public.decide_signup_application(p_application_id uuid, p_decision text, p_reviewer uuid, p_reason text default null)
returns public.signup_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  app        public.signup_applications;
  v_company  uuid;
  v_partner  uuid;
  v_venue    uuid;
  v_role     public.corporate_role;
  v_base     text;
  v_slug     text;
  n          integer := 1;
begin
  if p_decision not in ('active', 'rejected') then
    raise exception 'decision must be active or rejected' using errcode = '22023';
  end if;

  select * into app from public.signup_applications where id = p_application_id for update;
  if not found then
    raise exception 'This application was not found.' using errcode = 'P0002', hint = 'application_not_found';
  end if;
  if app.status <> 'pending_approval' then
    raise exception 'This application has already been decided.' using errcode = 'P0001', hint = 'application_decided';
  end if;

  if p_decision = 'rejected' then
    update public.signup_applications
       set status = 'rejected', reviewed_by = p_reviewer, reviewed_at = now(), rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = app.id
    returning * into app;
    return app;
  end if;

  if exists (select 1 from public.platform_users where user_id = app.user_id) then
    raise exception 'This person already has portal access.' using errcode = 'P0001', hint = 'already_member';
  end if;

  if app.account_type = 'enterprise' then
    select id into v_company from public.companies where gstin = app.gstin;
    if v_company is null then
      insert into public.companies (legal_name, gstin, primary_contact_email)
      values (btrim(app.company_name), app.gstin, app.email)
      returning id into v_company;
      v_role := 'APPROVER';   -- the account's first user runs it
    else
      v_role := 'ORGANIZER';  -- joining a customer that's already set up
    end if;
    insert into public.platform_users (user_id, role, company_id, corporate_role)
    values (app.user_id, 'CLIENT', v_company, v_role);
  elsif app.account_type = 'venue' then
    -- One venue per GSTIN: a listed venue's managers are added from /admin/managers.
    if exists (select 1 from public.venues where gstin = app.gstin) then
      raise exception 'A venue with this GSTIN is already on Lufer. Add this person from Venue managers instead.' using errcode = 'P0001', hint = 'venue_gstin_taken';
    end if;
    -- Unlisted until an admin publishes it (/admin/approvals).
    insert into public.venues (name, city, neighborhood, address, gstin, capacity_max, is_active)
    values (btrim(app.company_name), btrim(app.city), btrim(app.venue_area), btrim(app.venue_address), app.gstin, app.venue_capacity, false)
    returning id into v_venue;
    insert into public.platform_users (user_id, role, venue_id)
    values (app.user_id, 'PROPERTY', v_venue);
  else
    v_base := btrim(regexp_replace(lower(app.company_name), '[^a-z0-9]+', '-', 'g'), '-');
    v_base := left(coalesce(nullif(v_base, ''), 'partner'), 40);
    if char_length(v_base) < 2 then v_base := v_base || '-partner'; end if;
    v_base := btrim(v_base, '-');
    v_slug := v_base;
    while exists (select 1 from public.partners where slug = v_slug) loop
      n := n + 1;
      v_slug := v_base || '-' || n;
    end loop;
    insert into public.partners (name, slug, contact_email, gstin)
    values (btrim(app.company_name), v_slug, app.email, app.gstin)
    returning id into v_partner;
    insert into public.platform_users (user_id, role, partner_id, partner_role)
    values (app.user_id, 'PARTNER', v_partner, 'OWNER');
  end if;

  update public.signup_applications
     set status = 'active', reviewed_by = p_reviewer, reviewed_at = now(),
         company_id = v_company, partner_id = v_partner, venue_id = v_venue, rejection_reason = null
   where id = app.id
  returning * into app;
  return app;
end;
$$;

comment on function public.decide_signup_application(uuid, text, uuid, text) is
  'Approves (active) or rejects a pending signup application. Approval creates or joins the organisation (company, partner or unlisted venue) and the platform_users row in one transaction. p_reviewer is null for self-serve activation. Service role only.';

revoke all on function public.decide_signup_application(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_signup_application(uuid, text, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Self-serve activation, on email verification
-- -----------------------------------------------------------------------------

create or replace function public.activate_signup_application(p_application_id uuid)
returns public.signup_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.signup_applications;
begin
  select * into app from public.signup_applications where id = p_application_id for update;
  if not found then
    raise exception 'This application was not found.' using errcode = 'P0002', hint = 'application_not_found';
  end if;
  -- Already decided, or one an admin must decide: unchanged (the caller reads its status).
  if app.status <> 'pending_approval'
     or exists (select 1 from public.platform_users where user_id = app.user_id)
     or (app.account_type = 'enterprise' and exists (select 1 from public.companies where gstin = app.gstin))
     or (app.account_type = 'venue' and exists (select 1 from public.venues where gstin = app.gstin)) then
    return app;
  end if;
  return public.decide_signup_application(app.id, 'active', null);
end;
$$;

comment on function public.activate_signup_application(uuid) is
  'Activates a verified signup without an admin, unless it would join an existing company or venue (left pending for an admin). Service role only.';

revoke all on function public.activate_signup_application(uuid) from public, anon, authenticated;
grant execute on function public.activate_signup_application(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Venue managers can't list their own venue or change its commercial terms
-- -----------------------------------------------------------------------------
-- "property updates own venue" lets a manager update their venue's row; these
-- columns stay with platform admins and the service role (the app's checked
-- server code).

create or replace function public.guard_venue_admin_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' and not public.is_platform_admin()
     and (new.is_active is distinct from old.is_active
          or new.commission_rate is distinct from old.commission_rate
          or new.gstin is distinct from old.gstin) then
    raise exception 'Only Lufer admins can change a venue''s listing, commission or GSTIN.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists venues_guard_admin_columns on public.venues;
create trigger venues_guard_admin_columns
  before update on public.venues
  for each row execute function public.guard_venue_admin_columns();
