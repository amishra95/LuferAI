-- =============================================================================
-- 0030a · approval_status gains ESCALATED
-- -----------------------------------------------------------------------------
-- An approval whose approver didn't decide before its deadline (or that was
-- escalated by hand) is closed as ESCALATED and handed to the next tier up
-- (0030, escalate_booking_approval).
--
-- Kept in its own migration: Postgres refuses to use a newly added enum value
-- in the same transaction that added it, and 0030 uses it in its triggers.
-- =============================================================================

alter type public.approval_status add value if not exists 'ESCALATED';
