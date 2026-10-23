-- =============================================================================
-- Durable finance jobs: dead-lettered exports and tax invoice documents
-- -----------------------------------------------------------------------------
-- ERP exports and tax invoice rendering run as Vercel Workflow jobs
-- (workflows/erp-export.ts, workflows/tax-invoice.ts): 5 attempts with
-- exponential backoff (lib/jobs/retry-policy.ts), then the job is
-- dead-lettered, and the audit trail says so.
--
-- - expense_exports.status gains 'dead_lettered': every attempt failed (or the
--   failure was permanent). A manual export retries it in place, like 'failed'.
-- - tax_invoice_documents: a booking's GST tax invoice, rendered once as
--   print-ready HTML (browsers save it as PDF) with its SHA-256, or the
--   failure that stopped it.
-- =============================================================================

-- 1 · Dead-lettered exports ----------------------------------------------------------------------
alter table public.expense_exports drop constraint if exists expense_exports_status_check;
alter table public.expense_exports add constraint expense_exports_status_check
  check (status in ('delivered', 'mocked', 'failed', 'dead_lettered'));

-- 2 · Tax invoice documents ----------------------------------------------------------------------
create table if not exists public.tax_invoice_documents (
  booking_id      uuid primary key references public.bookings (id) on delete cascade,
  tenant_id       uuid not null references public.companies (id) on delete cascade,
  status          text not null check (status in ('rendered', 'failed', 'dead_lettered')),
  invoice_number  text,
  -- The exact HTML served, and its SHA-256 so finance can verify a copy.
  html            text,
  html_sha256     text check (html_sha256 is null or html_sha256 ~ '^[0-9a-f]{64}$'),
  attempts        integer not null default 1 check (attempts >= 1),
  error           text check (error is null or length(error) <= 500),
  rendered_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tax_invoice_documents_rendered_check
    check ((status = 'rendered') = (html is not null and html_sha256 is not null and rendered_at is not null))
);

create index if not exists tax_invoice_documents_tenant_idx on public.tax_invoice_documents (tenant_id, updated_at desc);

drop trigger if exists tax_invoice_documents_set_updated_at on public.tax_invoice_documents;
create trigger tax_invoice_documents_set_updated_at
  before update on public.tax_invoice_documents
  for each row execute function public.set_updated_at();

alter table public.tax_invoice_documents enable row level security;

drop policy if exists "admins read tax invoice documents" on public.tax_invoice_documents;
create policy "admins read tax invoice documents"
  on public.tax_invoice_documents for select to authenticated
  using ((select public.is_platform_admin()));

drop policy if exists "tenant users read own tax invoice documents" on public.tax_invoice_documents;
create policy "tenant users read own tax invoice documents"
  on public.tax_invoice_documents for select to authenticated
  using (tenant_id = (select public.current_company_id()));

drop policy if exists "venues read their tax invoice documents" on public.tax_invoice_documents;
create policy "venues read their tax invoice documents"
  on public.tax_invoice_documents for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = tax_invoice_documents.booking_id and b.venue_id = (select public.current_venue_id())
  ));
