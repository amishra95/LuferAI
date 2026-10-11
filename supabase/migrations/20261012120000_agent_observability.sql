-- =============================================================================
-- 0024 · Agent observability: persisted agent settings and per-call token usage
-- -----------------------------------------------------------------------------
-- agent_configurations   one row per configured agent (lib/agents/config.ts
--                        AGENT_IDS). Until now settings lived in server memory
--                        and reset on restart; the store (lib/agents/store.ts)
--                        now reads through to this table and writes on save.
--                        system_prompt holds the operator instructions appended
--                        to the agent's built-in prompt, not the whole prompt:
--                        the built-in guardrails (no invented figures, scope
--                        rules) stay in code.
-- agent_execution_logs   one row per model call (a step of an agent run), from
--                        the usage middleware in lib/ai/model.ts. cost is USD at
--                        list price (lib/ai/pricing.ts); null when the model's
--                        price isn't known.
--
-- The app writes both through the service role; admins read them.
-- =============================================================================

create table if not exists public.agent_configurations (
  id             uuid primary key default gen_random_uuid(),
  agent_key      text not null unique check (agent_key ~ '^[a-z][a-z0-9-]{1,47}$'),
  system_prompt  text not null default '' check (char_length(system_prompt) <= 1000),
  -- null = the model's default.
  temperature    numeric(3, 2) check (temperature is null or (temperature >= 0 and temperature <= 2)),
  model_backend  text not null default 'gpt-4o' check (model_backend in ('gpt-4o', 'claude-sonnet-5-5')),
  enabled        boolean not null default true,
  tools          text[] not null default '{}',
  max_steps      smallint not null default 5 check (max_steps between 1 and 10),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now()
);

drop trigger if exists agent_configurations_set_updated_at on public.agent_configurations;
create trigger agent_configurations_set_updated_at
  before update on public.agent_configurations
  for each row execute function public.set_updated_at();

create table if not exists public.agent_execution_logs (
  id                 uuid primary key default gen_random_uuid(),
  agent_key          text not null check (char_length(agent_key) between 1 and 64),
  -- The provider's model id as called (e.g. gpt-4o, claude-sonnet-5-5).
  model              text not null check (char_length(model) between 1 and 100),
  source             text not null default 'api' check (char_length(source) between 1 and 32),
  prompt_tokens      integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens  integer not null default 0 check (completion_tokens >= 0),
  cost               numeric(12, 6) check (cost is null or cost >= 0),
  executed_at        timestamptz not null default now()
);

create index if not exists agent_execution_logs_executed_at_idx on public.agent_execution_logs (executed_at desc);
create index if not exists agent_execution_logs_agent_idx on public.agent_execution_logs (agent_key, executed_at desc);

alter table public.agent_configurations enable row level security;
alter table public.agent_execution_logs enable row level security;

create policy "admins read agent configurations"
  on public.agent_configurations for select to authenticated
  using ((select public.is_platform_admin()));

create policy "admins read agent execution logs"
  on public.agent_execution_logs for select to authenticated
  using ((select public.is_platform_admin()));
