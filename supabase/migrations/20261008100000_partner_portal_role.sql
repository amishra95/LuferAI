-- Partner extranet, part 1: the PARTNER portal role.
-- Its own migration because Postgres can't use a new enum value in the
-- transaction that adds it; 20261008100100_partner_extranet.sql uses it.
alter type public.portal_role add value if not exists 'PARTNER';
