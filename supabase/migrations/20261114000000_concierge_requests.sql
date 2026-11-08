-- =============================================================================
-- Concierge requests: every quote request and event brief Lufer arranges by hand
-- -----------------------------------------------------------------------------
-- Wizard of Oz: a company asks for a quote on a listing Lufer doesn't book
-- directly (partner_venues), or sends a Plan-an-event brief. Until now these
-- were emails only; now each is a row first, so none is lost if an email
-- fails, the requester can see where it stands on Home, and Lufer works the
-- queue at /admin/requests.
--
-- status: new → working → options_sent → booked, or closed at any point.
-- note: one line from Lufer that the requester sees ("Sent 3 options by email").
-- Writes go through the service role only (the app's server code checks who
-- may request, and that only admins update); the company and admins read.
-- =============================================================================

create table if not exists public.concierge_requests (
  id               uuid primary key default gen_random_uuid(),
  -- Null for a request an admin sends while testing (no company).
  company_id       uuid references public.companies (id) on delete cascade,
  requested_by     uuid references auth.users (id) on delete set null,
  requester_email  text not null check (char_length(requester_email) between 3 and 254),
  kind             text not null check (kind in ('quote', 'brief')),
  partner_venue_id uuid references public.partner_venues (id) on delete set null,
  venue_name       text check (venue_name is null or char_length(venue_name) <= 200),
  event_date       date,
  guests           integer check (guests is null or guests between 1 and 100000),
  per_head_inr     integer check (per_head_inr is null or per_head_inr between 0 and 10000000),
  details          text check (details is null or char_length(details) <= 4000),
  rfp_id           uuid references public.rfps (id) on delete set null,
  status           text not null default 'new' check (status in ('new', 'working', 'options_sent', 'booked', 'closed')),
  note             text check (note is null or char_length(note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint concierge_requests_quote_has_venue check (kind <> 'quote' or venue_name is not null)
);

comment on table public.concierge_requests is
  'Quote requests and event briefs Lufer''s concierge arranges by hand (Wizard of Oz). Service role writes only.';

create index if not exists concierge_requests_company_idx on public.concierge_requests (company_id, created_at desc);
create index if not exists concierge_requests_open_idx on public.concierge_requests (created_at desc) where status in ('new', 'working');

drop trigger if exists concierge_requests_set_updated_at on public.concierge_requests;
create trigger concierge_requests_set_updated_at
  before update on public.concierge_requests
  for each row execute function public.set_updated_at();

alter table public.concierge_requests enable row level security;
revoke all on public.concierge_requests from anon, authenticated;
grant select on public.concierge_requests to authenticated;

drop policy if exists "company members read their requests" on public.concierge_requests;
create policy "company members read their requests" on public.concierge_requests
  for select to authenticated
  using (company_id = (select public.current_company_id()));

drop policy if exists "platform admins read requests" on public.concierge_requests;
create policy "platform admins read requests" on public.concierge_requests
  for select to authenticated
  using ((select public.is_platform_admin()));
