-- =============================================================================
-- 0008 · booking_status gains PENDING_APPROVAL
-- -----------------------------------------------------------------------------
-- A booking that breaches its company's corporate_policies waits here for an
-- internal manager's sign-off before the venue ever sees it.
--
-- Kept in its own migration: Postgres refuses to use a newly added enum value
-- in the same transaction that added it, and 0009 uses it in checks/policies.
-- =============================================================================

alter type public.booking_status add value if not exists 'PENDING_APPROVAL' before 'PENDING';
