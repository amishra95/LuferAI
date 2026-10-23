-- =============================================================================
-- Self-service signup with admin approval
-- -----------------------------------------------------------------------------
-- People apply at /signup as an enterprise (a corporate buyer) or a partner (a
-- supplier: entertainment, experiences, catering…). Each application is one
-- row here, created once the applicant's email is verified (their magic link).
-- Until a platform admin approves it they have no platform_users row, so no
-- portal: the app sends them to /signup/pending.
--
-- Approving (decide_signup_application, one transaction):
--   enterprise  the company with that GSTIN, or a new one; the applicant joins
--               as APPROVER of a new company, ORGANIZER of an existing one
--   partner     a new partner organisation; the applicant is its OWNER
-- then a platform_users row, which is all the portals and RLS look at.
--
-- Applicants read their own row; admins read all. Writes go through the
-- service role only, after the app's checks.
-- =============================================================================

create table if not exists public.signup_applications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  email             text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  full_name         text not null check (char_length(btrim(full_name)) between 2 and 120),
  phone             text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  account_type      text not null check (account_type in ('enterprise', 'partner')),
  status            text not null default 'pending_approval' check (status in ('pending_approval', 'active', 'rejected')),
  company_name      text not null check (char_length(btrim(company_name)) between 2 and 120),
  job_title         text check (job_title is null or char_length(job_title) <= 120),
  gstin             char(15) check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  venue_website     text check (venue_website is null or (venue_website ~* '^https?://' and char_length(venue_website) <= 500)),
  -- What a partner offers; the applicant becomes the OWNER of their partner organisation.
  partner_role      text check (partner_role is null or partner_role in ('entertainment', 'experiences', 'catering', 'decor', 'av_production', 'gifting', 'other')),
  city              text check (city is null or char_length(city) <= 80),
  message           text check (message is null or char_length(message) <= 1000),
  -- Set on approval: what the applicant joined.
  company_id        uuid references public.companies (id) on delete set null,
  partner_id        uuid references public.partners (id) on delete set null,
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewed_at       timestamptz,
  rejection_reason  text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Enterprises are invoiced on their GSTIN; partners say what they offer.
  constraint signup_applications_enterprise_gstin check (account_type <> 'enterprise' or gstin is not null),
  constraint signup_applications_partner_role check ((account_type = 'partner') = (partner_role is not null)),
  constraint signup_applications_reviewed check ((status = 'pending_approval') = (reviewed_at is null))
);

comment on table public.signup_applications is
  'Self-service signup applications (enterprise or partner), approved or rejected by platform admins. Service role writes only.';

create index if not exists signup_applications_queue_idx on public.signup_applications (status, created_at);

drop trigger if exists signup_applications_set_updated_at on public.signup_applications;
create trigger signup_applications_set_updated_at
  before update on public.signup_applications
  for each row execute function public.set_updated_at();

alter table public.signup_applications enable row level security;
revoke all on public.signup_applications from anon, authenticated;
grant select on public.signup_applications to authenticated;

drop policy if exists "applicants read own application" on public.signup_applications;
create policy "applicants read own application" on public.signup_applications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "platform admins read applications" on public.signup_applications;
create policy "platform admins read applications" on public.signup_applications
  for select to authenticated
  using ((select public.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- Deciding an application
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
     set status = 'active', reviewed_by = p_reviewer, reviewed_at = now(), company_id = v_company, partner_id = v_partner, rejection_reason = null
   where id = app.id
  returning * into app;
  return app;
end;
$$;

comment on function public.decide_signup_application(uuid, text, uuid, text) is
  'Approves (active) or rejects a pending signup application. Approval creates or joins the organisation and the platform_users row in one transaction. Service role only.';

revoke all on function public.decide_signup_application(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_signup_application(uuid, text, uuid, text) to service_role;
