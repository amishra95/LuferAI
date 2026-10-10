-- =============================================================================
-- 0022 · Multiplayer event workspace: schedule, guest list, RSVPs, live rooms
-- -----------------------------------------------------------------------------
-- Each booking gets a planning workspace (/client/events/<booking id>) that the
-- company's team edits together:
--   event_workspaces  one row per booking (created on first save): title, start/end
--                     time (IST wall clock), RSVP deadline, and the iCalendar
--                     SEQUENCE so every exported .ics updates the same entry.
--   event_attendees   the guest list. Each guest RSVPs at /rsvp/<token> without
--                     an account; the page uses the service role, never RLS.
--
-- Realtime: both tables join the supabase_realtime publication (organisers see
-- RSVPs arrive live), and private channels `event:<booking id>` (presence and
-- cursors) are authorised to the booking's company and admins. Both steps are
-- skipped where Realtime isn't installed (plain Postgres, the PGlite tests).
--
-- Guest names, emails and dietary notes are personal data: venues see none of
-- it (they get the headcount through the booking), only the company and admins.
-- Rules mirrored in lib/events/rsvp.ts.
-- =============================================================================

-- 1 · Workspaces -------------------------------------------------------------------------------
create table if not exists public.event_workspaces (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null unique,
  tenant_id      uuid not null references public.companies (id) on delete cascade,
  title          text check (title is null or char_length(btrim(title)) between 2 and 120),
  -- Wall-clock times in IST (the platform is India-only). An end at or before the
  -- start runs past midnight.
  starts_at      time not null default '19:00',
  ends_at        time not null default '22:00',
  rsvp_deadline  date,
  -- RFC 5545: invites use the booking id as UID; SEQUENCE goes up on every
  -- change attendees should see, so calendars replace their copy.
  ics_sequence   integer not null default 0 check (ics_sequence >= 0),
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint event_workspaces_booking_fkey
    foreign key (booking_id, tenant_id) references public.bookings (id, company_id) on delete cascade
);

comment on table public.event_workspaces is 'Planning workspace per booking: schedule, RSVP deadline and the calendar SEQUENCE of its invites.';

create trigger event_workspaces_set_updated_at
  before update on public.event_workspaces
  for each row execute function public.set_updated_at();

create or replace function public.event_workspaces_bump_sequence()
returns trigger
language plpgsql
as $$
begin
  if (new.title, new.starts_at, new.ends_at) is distinct from (old.title, old.starts_at, old.ends_at) then
    new.ics_sequence := old.ics_sequence + 1;
  else
    new.ics_sequence := old.ics_sequence;
  end if;
  return new;
end;
$$;

create trigger event_workspaces_bump_sequence
  before update on public.event_workspaces
  for each row execute function public.event_workspaces_bump_sequence();

-- 2 · Guest list -------------------------------------------------------------------------------
create table if not exists public.event_attendees (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null,
  tenant_id     uuid not null references public.companies (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 2 and 80),
  email         text not null check (email = lower(email) and email ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' and char_length(email) <= 254),
  rsvp_status   text not null default 'INVITED' check (rsvp_status in ('INVITED', 'ACCEPTED', 'TENTATIVE', 'DECLINED')),
  plus_ones     smallint not null default 0 check (plus_ones between 0 and 5),
  dietary       text check (dietary is null or char_length(dietary) <= 200),
  -- The guest's RSVP link (/rsvp/<token>): 256 random bits, unguessable.
  rsvp_token    text not null unique
                  default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
                  check (rsvp_token ~ '^[0-9a-f]{64}$'),
  responded_at  timestamptz,
  invited_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (booking_id, email),
  constraint event_attendees_booking_fkey
    foreign key (booking_id, tenant_id) references public.bookings (id, company_id) on delete cascade
);

comment on table public.event_attendees is 'Guest list and RSVPs for a booking. Personal data: company and admins only.';
comment on column public.event_attendees.plus_ones is 'Extra guests the attendee brings (only counted while ACCEPTED or TENTATIVE).';

create index if not exists event_attendees_booking_idx on public.event_attendees (booking_id, rsvp_status);

create trigger event_attendees_set_updated_at
  before update on public.event_attendees
  for each row execute function public.set_updated_at();

create or replace function public.event_attendees_track_response()
returns trigger
language plpgsql
as $$
begin
  new.rsvp_token := old.rsvp_token;
  if new.rsvp_status is distinct from old.rsvp_status then
    new.responded_at := case when new.rsvp_status = 'INVITED' then null else now() end;
  end if;
  -- A guest who isn't coming brings no one.
  if new.rsvp_status = 'DECLINED' then
    new.plus_ones := 0;
  end if;
  return new;
end;
$$;

create trigger event_attendees_track_response
  before update on public.event_attendees
  for each row execute function public.event_attendees_track_response();

-- 3 · Row Level Security -----------------------------------------------------------------------
alter table public.event_workspaces enable row level security;
alter table public.event_attendees  enable row level security;

create policy "admins manage event workspaces"
  on public.event_workspaces for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "tenant users read own event workspaces"
  on public.event_workspaces for select to authenticated
  using (tenant_id = (select public.current_company_id()));

create policy "admins manage event attendees"
  on public.event_attendees for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- Reads only: the app writes through server actions (Organizers and Approvers,
-- not Finance viewers), and the RSVP page through the service role.
create policy "tenant users read own event attendees"
  on public.event_attendees for select to authenticated
  using (tenant_id = (select public.current_company_id()));

-- 4 · Realtime ---------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'event_attendees') then
      alter publication supabase_realtime add table public.event_attendees;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'event_workspaces') then
      alter publication supabase_realtime add table public.event_workspaces;
    end if;
  end if;

  -- Private channels `event:<booking id>`: presence and cursor broadcasts are
  -- limited to the booking's company and admins (Realtime Authorization).
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create or replace function public.can_join_event_channel(topic text)
      returns boolean
      language sql stable security definer set search_path = public
      as $f$
        select topic ~ '^event:[0-9a-f-]{36}$' and (
          public.is_platform_admin()
          or exists (
            select 1 from public.bookings b
            where b.id = substr(topic, 7)::uuid and b.company_id = public.current_company_id()
          )
        )
      $f$
    $p$;
    execute 'revoke execute on function public.can_join_event_channel(text) from public, anon';
    execute 'grant execute on function public.can_join_event_channel(text) to authenticated';
    execute 'drop policy if exists "event channel members receive" on realtime.messages';
    execute 'drop policy if exists "event channel members send" on realtime.messages';
    execute $p$
      create policy "event channel members receive" on realtime.messages for select to authenticated
      using (extension in ('presence', 'broadcast') and public.can_join_event_channel((select realtime.topic())))
    $p$;
    execute $p$
      create policy "event channel members send" on realtime.messages for insert to authenticated
      with check (extension in ('presence', 'broadcast') and public.can_join_event_channel((select realtime.topic())))
    $p$;
  end if;
end;
$$;
