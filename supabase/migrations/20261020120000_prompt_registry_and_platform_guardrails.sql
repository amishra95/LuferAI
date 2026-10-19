-- =============================================================================
-- 0028 · Prompt registry and platform guardrails (admin, /agents)
-- -----------------------------------------------------------------------------
-- agent_prompt_versions        Versioned system prompts for the negotiation agents.
--                              Admins draft and edit a version, then activate it; at
--                              most one version per prompt is active, and the agent
--                              uses it within seconds (lib/ai/prompt-store.ts). Only
--                              drafts are editable: active and archived versions are
--                              the record of what ran. With none active, the agent
--                              uses the built-in prompt in lib/ai/prompts.ts.
-- activate_prompt_version()    Archives the active version and activates another in
--                              one statement, so there's never zero or two active.
-- platform_guardrail_settings  One row: the platform-wide ceilings admins tune on
--                              /agents (discount cap, auto-counter/decline switches,
--                              decline trigger, escalation thresholds, AI change
--                              limits). Venue hosts' own rules apply within them
--                              (lib/guardrails/platform.ts parses and clamps).
--
-- The app writes through the service role; platform admins read both tables.
-- =============================================================================

create table if not exists public.agent_prompt_versions (
  id            uuid primary key default gen_random_uuid(),
  prompt_key    text not null check (prompt_key in ('property-negotiator')),
  version       integer not null check (version >= 1),
  body          text not null check (char_length(body) between 40 and 8000),
  note          text check (note is null or char_length(note) <= 200),
  status        text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  activated_at  timestamptz,
  activated_by  uuid references auth.users (id) on delete set null,
  constraint agent_prompt_versions_key_version_key unique (prompt_key, version)
);

create unique index if not exists agent_prompt_versions_one_active
  on public.agent_prompt_versions (prompt_key) where status = 'active';

drop trigger if exists agent_prompt_versions_set_updated_at on public.agent_prompt_versions;
create trigger agent_prompt_versions_set_updated_at
  before update on public.agent_prompt_versions
  for each row execute function public.set_updated_at();

create or replace function public.activate_prompt_version(p_id uuid, p_user uuid)
returns public.agent_prompt_versions
language plpgsql security definer set search_path = public
as $$
declare
  target public.agent_prompt_versions;
begin
  select * into target from public.agent_prompt_versions where id = p_id for update;
  if not found then
    raise exception 'prompt version % not found', p_id using errcode = 'P0002';
  end if;
  -- Lock the prompt's active row too, so two activations serialise.
  perform 1 from public.agent_prompt_versions where prompt_key = target.prompt_key and status = 'active' for update;
  update public.agent_prompt_versions
     set status = 'archived'
   where prompt_key = target.prompt_key and status = 'active' and id <> p_id;
  update public.agent_prompt_versions
     set status = 'active', activated_at = now(), activated_by = p_user
   where id = p_id
  returning * into target;
  return target;
end;
$$;

revoke execute on function public.activate_prompt_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_prompt_version(uuid, uuid) to service_role;

create table if not exists public.platform_guardrail_settings (
  id          boolean primary key default true check (id),
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);

drop trigger if exists platform_guardrail_settings_set_updated_at on public.platform_guardrail_settings;
create trigger platform_guardrail_settings_set_updated_at
  before update on public.platform_guardrail_settings
  for each row execute function public.set_updated_at();

alter table public.agent_prompt_versions       enable row level security;
alter table public.platform_guardrail_settings enable row level security;

create policy "admins read prompt versions"
  on public.agent_prompt_versions for select to authenticated
  using ((select public.is_platform_admin()));

create policy "admins read platform guardrails"
  on public.platform_guardrail_settings for select to authenticated
  using ((select public.is_platform_admin()));
