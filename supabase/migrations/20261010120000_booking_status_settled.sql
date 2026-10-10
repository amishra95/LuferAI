-- =============================================================================
-- 0018 · booking_status gains SETTLED
-- -----------------------------------------------------------------------------
-- The end of a booking's lifecycle: after the event (COMPLETED) the spend is
-- reimbursed / settled in the company's expense system.
--
--   PENDING_APPROVAL → PENDING → CONFIRMED → COMPLETED → SETTLED
--   (requested / awaiting sign-off) (with the venue) (confirmed) (held) (settled)
--
-- Kept in its own migration: Postgres refuses to use a newly added enum value
-- in the same transaction that added it, and 0019 uses it.
-- =============================================================================

alter type public.booking_status add value if not exists 'SETTLED' after 'COMPLETED';
