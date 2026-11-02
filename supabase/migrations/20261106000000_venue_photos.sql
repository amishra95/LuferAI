-- Venue photos on cards and listings.
--
-- - venues.photos: Storage object paths in the public venue-photos bucket
--   ("<venue id>/<uuid>.<ext>"), cover first, at most 8. Absolute https URLs
--   are also accepted (seeds, imports). lib/venues/photos.ts turns them into URLs.
-- - venue-photos bucket: public read (cards render without a signed URL),
--   5 MB, JPEG/PNG/WebP only. No insert/update policies: hosts upload through a
--   signed upload URL the server issues after checking they manage the venue,
--   and the server (service role) attaches or removes the path.

alter table public.venues
  add column if not exists photos text[] not null default '{}';

alter table public.venues
  add constraint venues_photos_max check (cardinality(photos) <= 8);

-- Supabase only: plain Postgres (the test harness) has no Storage schema.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('venue-photos', 'venue-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;
