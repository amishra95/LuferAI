-- =============================================================================
-- 0034 · Gemini as the default agent backend
-- -----------------------------------------------------------------------------
-- agent_configurations.model_backend gains 'gemini-3.8-flash' (Google, model id
-- from GEMINI_MODEL) and defaults to it. Agents saved on gpt-4o move to Gemini:
-- gpt-4o was the default, not a choice most agents made, and OpenAI stays in the
-- failover order behind Gemini. Claude Sonnet 5.5 choices are kept.
-- =============================================================================

alter table public.agent_configurations
  drop constraint if exists agent_configurations_model_backend_check;

alter table public.agent_configurations
  add constraint agent_configurations_model_backend_check
  check (model_backend in ('gemini-3.8-flash', 'gpt-4o', 'claude-sonnet-5-5'));

alter table public.agent_configurations
  alter column model_backend set default 'gemini-3.8-flash';

update public.agent_configurations
  set model_backend = 'gemini-3.8-flash', updated_at = now()
  where model_backend = 'gpt-4o';
