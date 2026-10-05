-- =============================================================================
-- 0012 · Departments (budget tracking) + venue coordinates (client map)
-- -----------------------------------------------------------------------------
-- - departments: annual budgets per company (Indian FY, Apr–Mar, pre-GST); a
--   booking may be charged to one. Reported on /admin; approval routing stays
--   with corporate_policies / approval_chains (0007–0009).
-- - venues.latitude/longitude for the MapLibre venue map.
-- =============================================================================

create table if not exists public.departments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  name               text not null check (length(trim(name)) > 0),
  annual_budget_inr  numeric(14,2) not null default 0 check (annual_budget_inr >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint departments_company_name_key unique (company_id, name),
  -- Lets bookings reference (department, company) so a booking can't be charged
  -- to another company's department.
  constraint departments_id_company_key unique (id, company_id)
);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

alter table public.bookings
  add column if not exists department_id uuid;

alter table public.bookings
  add constraint bookings_department_same_company
    foreign key (department_id, company_id) references public.departments (id, company_id)
    on delete set null (department_id);

create index if not exists bookings_department_idx on public.bookings (department_id);

alter table public.venues
  add column if not exists latitude  numeric(9,6) check (latitude between -90 and 90),
  add column if not exists longitude numeric(9,6) check (longitude between -180 and 180);

-- RLS ---------------------------------------------------------------------------------
alter table public.departments enable row level security;

create policy "admins manage departments"
  on public.departments for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "clients read own departments"
  on public.departments for select to authenticated
  using (company_id = public.current_company_id());
