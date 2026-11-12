-- Photos on partner listings (the Lufer Concierge venues and other partners'
-- listings), so an admin can add them from /admin/photos.
--
-- Same shape as venues.photos: Storage object paths in the public venue-photos
-- bucket ("<listing id>/<uuid>.<ext>"), cover first, at most 8. Uploads go
-- through a signed upload URL the server issues to admins only.

alter table public.partner_venues
  add column if not exists photos text[] not null default '{}';

alter table public.partner_venues
  add constraint partner_venues_photos_max check (cardinality(photos) <= 8);
