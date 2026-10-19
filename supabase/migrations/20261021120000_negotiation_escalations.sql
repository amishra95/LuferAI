-- =============================================================================
-- 0029 · Negotiation escalations: human-in-the-loop queue with an audit trail
-- -----------------------------------------------------------------------------
-- negotiation_escalations        An automatic counter the platform held back
--                                (escalation thresholds, lib/guardrails/platform.ts):
--                                the instant quote stands until the venue host or an
--                                admin approves it, sends a modified price, or rejects
--                                it. A manual counter/decline from the RFP inbox, or
--                                the RFP closing, supersedes it. At most one open
--                                escalation per RFP response.
-- negotiation_escalation_events  Append-only audit trail: opened, each decision (who,
--                                at what price), supersession, and every notification
--                                attempt (in-app, Slack, WhatsApp) with its result.
-- venue_negotiation_rules.alert_whatsapp
--                                Optional E.164 number the host wants escalation
--                                alerts on.
--
-- The app writes through the service role (lib/escalations). Venue managers read
-- their own venue's rows and admins read all.
-- =============================================================================

create table if not exists public.negotiation_escalations (
  id                     uuid primary key default gen_random_uuid(),
  rfp_id                 uuid not null references public.rfps (id) on delete cascade,
  response_id            uuid not null references public.rfp_responses (id) on delete cascade,
  venue_id               uuid not null references public.venues (id) on delete cascade,
  status                 text not null default 'open' check (status in ('open', 'approved', 'modified', 'rejected', 'superseded')),
  -- What the automatic counter would have sent, and the venue's own price it was measured from.
  proposed_per_head_inr  numeric(12,2) not null check (proposed_per_head_inr > 0),
  standard_per_head_inr  numeric(12,2) check (standard_per_head_inr is null or standard_per_head_inr > 0),
  party_size             integer not null check (party_size > 0),
  reason                 text not null check (char_length(reason) between 1 and 500),
  decided_per_head_inr   numeric(12,2) check (decided_per_head_inr is null or decided_per_head_inr > 0),
  decision_note          text check (decision_note is null or char_length(decision_note) <= 280),
  decided_by             uuid references auth.users (id) on delete set null,
  decided_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint negotiation_escalations_decided check ((status = 'open') = (decided_at is null))
);

create unique index if not exists negotiation_escalations_one_open
  on public.negotiation_escalations (response_id) where status = 'open';
create index if not exists negotiation_escalations_venue_idx on public.negotiation_escalations (venue_id, status, created_at desc);

drop trigger if exists negotiation_escalations_set_updated_at on public.negotiation_escalations;
create trigger negotiation_escalations_set_updated_at
  before update on public.negotiation_escalations
  for each row execute function public.set_updated_at();

create table if not exists public.negotiation_escalation_events (
  id             uuid primary key default gen_random_uuid(),
  escalation_id  uuid not null references public.negotiation_escalations (id) on delete cascade,
  action         text not null check (action in ('opened', 'approved', 'modified', 'rejected', 'superseded', 'reopened', 'notified', 'notify_failed')),
  actor_id       uuid references auth.users (id) on delete set null,
  -- 'system' for automatic steps, else the actor's portal role at the time.
  actor_role     text not null default 'system',
  detail         jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at     timestamptz not null default now()
);

create index if not exists negotiation_escalation_events_escalation_idx on public.negotiation_escalation_events (escalation_id, created_at);

-- The trail is append-only, even for the service role's own mistakes.
create or replace function public.negotiation_escalation_events_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'negotiation_escalation_events is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists negotiation_escalation_events_no_update on public.negotiation_escalation_events;
create trigger negotiation_escalation_events_no_update
  before update or delete on public.negotiation_escalation_events
  for each row execute function public.negotiation_escalation_events_immutable();

alter table public.venue_negotiation_rules
  add column if not exists alert_whatsapp text check (alert_whatsapp is null or alert_whatsapp ~ '^\+[1-9][0-9]{7,14}$');

alter table public.negotiation_escalations       enable row level security;
alter table public.negotiation_escalation_events enable row level security;

create policy "admins read escalations"
  on public.negotiation_escalations for select to authenticated
  using ((select public.is_platform_admin()));

create policy "venues read own escalations"
  on public.negotiation_escalations for select to authenticated
  using (venue_id = (select public.current_venue_id()));

create policy "admins read escalation events"
  on public.negotiation_escalation_events for select to authenticated
  using ((select public.is_platform_admin()));

create policy "venues read own escalation events"
  on public.negotiation_escalation_events for select to authenticated
  using (exists (
    select 1 from public.negotiation_escalations e
    where e.id = escalation_id and e.venue_id = (select public.current_venue_id())
  ));
