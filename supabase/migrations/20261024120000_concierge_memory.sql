-- =============================================================================
-- 0032 · Concierge memory: user preferences and episodic booking memory
-- -----------------------------------------------------------------------------
-- user_preferences    One row per user: dietary needs, seating, favourite cuisines
--                     and a per-head budget ceiling (INR, pre-GST). The concierge
--                     (/api/agent/chat) reads it before every turn and updates it
--                     when the user states a lasting preference.
-- booking_memories    Episodic memory: short summaries of what happened ("Booked Toit
--                     for 12 on 24 Oct; team liked the rooftop"), each with a 768-d
--                     embedding (gemini-embedding-001) for similarity search.
-- match_booking_memories(query, n)
--                     The caller's own memories closest to a query embedding.
--
-- Rows belong to one user and are read and written with that user's session (RLS),
-- never across users. Removing someone from platform_users cuts off access at once.
-- =============================================================================

create extension if not exists vector with schema extensions;

-- 1 · Preferences ----------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id                    uuid primary key references auth.users (id) on delete cascade,
  dietary                    text[] not null default '{}'
                               check (cardinality(dietary) <= 20),
  seating                    text check (seating is null or char_length(seating) <= 200),
  cuisines                   text[] not null default '{}'
                               check (cardinality(cuisines) <= 20),
  budget_limit_per_head_inr  numeric(12, 2) check (budget_limit_per_head_inr is null or budget_limit_per_head_inr > 0),
  notes                      text check (notes is null or char_length(notes) <= 1000),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

comment on table public.user_preferences is 'Standing hospitality preferences the concierge applies to every request.';
comment on column public.user_preferences.budget_limit_per_head_inr is 'Ceiling per guest, INR before GST.';

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- 2 · Episodic memory ------------------------------------------------------------------------
create table if not exists public.booking_memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  booking_id  uuid references public.bookings (id) on delete set null,
  kind        text not null default 'note' check (kind in ('booking', 'feedback', 'note')),
  summary     text not null check (char_length(summary) between 1 and 1000),
  embedding   extensions.vector(768) not null,
  created_at  timestamptz not null default now()
);

comment on table public.booking_memories is 'Concierge episodic memory: summaries of past bookings and feedback, embedded for recall.';

create index if not exists booking_memories_user_idx on public.booking_memories (user_id, created_at desc);
create index if not exists booking_memories_embedding_idx
  on public.booking_memories using hnsw (embedding extensions.vector_cosine_ops);

-- 3 · Recall ---------------------------------------------------------------------------------
-- Security invoker: RLS limits it to the caller's own rows.
create or replace function public.match_booking_memories(query_embedding extensions.vector(768), match_count integer default 5)
returns table (id uuid, booking_id uuid, kind text, summary text, created_at timestamptz, similarity double precision)
language sql stable security invoker set search_path = public, extensions
as $$
  select m.id, m.booking_id, m.kind, m.summary, m.created_at, 1 - (m.embedding <=> query_embedding) as similarity
  from public.booking_memories m
  where m.user_id = (select auth.uid())
  order by m.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20)
$$;

-- 4 · RLS ------------------------------------------------------------------------------------
alter table public.user_preferences enable row level security;
alter table public.booking_memories enable row level security;

-- Own rows only, and only while the user still has a platform membership.
create policy "users manage own preferences"
  on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()) and (select public.current_portal_role()) is not null)
  with check (user_id = (select auth.uid()) and (select public.current_portal_role()) is not null);

create policy "users read own memories"
  on public.booking_memories for select to authenticated
  using (user_id = (select auth.uid()) and (select public.current_portal_role()) is not null);

-- A memory may only point at a booking the user can see (bookings' own policies apply in the subquery).
create policy "users add own memories"
  on public.booking_memories for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.current_portal_role()) is not null
    and (booking_id is null or exists (select 1 from public.bookings b where b.id = booking_id))
  );

create policy "users delete own memories"
  on public.booking_memories for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.current_portal_role()) is not null);
