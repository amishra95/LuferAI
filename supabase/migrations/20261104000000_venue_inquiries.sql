-- =============================================================================
-- Venue inquiries: the venue's AI inquiry agent
-- -----------------------------------------------------------------------------
-- Anyone can ask a venue about an event on its public inquiry page
-- (/inquire/<venue id>): the agent (lib/venues/inquiry-agent.ts) answers from
-- the venue's own facts, checks the date, gathers the details a venue needs to
-- quote (who, how many, when, budget, contact), and when the venue can't host
-- suggests other venues in the network instead of losing the lead.
--
-- One row per conversation. The visitor continues it with a secret token they
-- hold; only its SHA-256 is stored. The venue's property managers read their
-- venue's inquiries (/property → Inquiries); admins read all. Writes go
-- through the service role only.
-- =============================================================================

create table if not exists public.venue_inquiries (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references public.venues (id) on delete cascade,
  token_sha256        text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  -- open: talking; qualified: the venue has what it needs to quote; referred:
  -- the venue couldn't host and other venues were suggested; converted / closed: the venue's call.
  status              text not null default 'open' check (status in ('open', 'qualified', 'referred', 'converted', 'closed')),
  contact_name        text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email       text check (contact_email is null or (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(contact_email) <= 254)),
  contact_phone       text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  company_name        text check (company_name is null or char_length(company_name) <= 200),
  party_size          integer check (party_size is null or party_size between 1 and 5000),
  event_date          date,
  budget_per_head_inr numeric(12,2) check (budget_per_head_inr is null or budget_per_head_inr > 0),
  occasion            text check (occasion is null or char_length(occasion) <= 200),
  notes               text check (notes is null or char_length(notes) <= 1000),
  -- Whether the venue could host on event_date when last checked.
  date_available      boolean,
  -- Other network venues suggested when this one couldn't host.
  referred_venue_ids  uuid[] not null default '{}',
  -- [{ "role": "visitor" | "agent", "text": "…", "at": "…" }], capped by the app at 40 turns.
  messages            jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  qualified_at        timestamptz,
  last_message_at     timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.venue_inquiries is
  'Conversations on a venue''s public inquiry page with its AI agent: the lead''s details, status and transcript. Service role writes only.';

create index if not exists venue_inquiries_venue_idx on public.venue_inquiries (venue_id, last_message_at desc);

drop trigger if exists venue_inquiries_set_updated_at on public.venue_inquiries;
create trigger venue_inquiries_set_updated_at
  before update on public.venue_inquiries
  for each row execute function public.set_updated_at();

alter table public.venue_inquiries enable row level security;
revoke all on public.venue_inquiries from anon, authenticated;
grant select on public.venue_inquiries to authenticated;

drop policy if exists "venue managers read their inquiries" on public.venue_inquiries;
create policy "venue managers read their inquiries" on public.venue_inquiries
  for select to authenticated
  using (venue_id = (select public.current_venue_id()));

drop policy if exists "platform admins read inquiries" on public.venue_inquiries;
create policy "platform admins read inquiries" on public.venue_inquiries
  for select to authenticated
  using ((select public.is_platform_admin()));
