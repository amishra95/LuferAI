"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, Loader2, Star, Trash2 } from "lucide-react";

import { attachPhotoAction, startPhotoUploadAction, updatePhotoAction, type HostFormState } from "../actions";
import { Feedback, IDLE } from "./host-forms";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { MAX_PHOTOS, PHOTO_BUCKET, PHOTO_TYPES } from "@/lib/venues/photos";

export interface HostPhoto {
  /** What venues.photos stores (path or URL); sent back to remove or reorder. */
  ref: string;
  url: string;
}

/**
 * The venue's listing photos: cover first, add (uploaded from the browser
 * straight to Storage through a signed slot), make cover, remove.
 */
export function PhotoManager({ venueId, venueName, photos }: { venueId: string; venueName: string; photos: HostPhoto[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<HostFormState>(IDLE);
  const [pending, startTransition] = useTransition();
  const full = photos.length >= MAX_PHOTOS;

  const upload = (file: File) =>
    startTransition(async () => {
      const slot = await startPhotoUploadAction({ venueId, type: file.type, size: file.size });
      if (!slot.ok) return setState({ status: "error", message: slot.error });
      const { error } = await createClient().storage.from(PHOTO_BUCKET).uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
      if (error) return setState({ status: "error", message: "The upload failed. Check your connection and try again." });
      setState(await attachPhotoAction({ venueId, path: slot.path }));
    });

  return (
    <div className="grid gap-4">
      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Photos">
          {photos.map((p, i) => (
            <li key={p.ref} className="border-line bg-surface relative overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element -- Storage URLs; next/image would need every project's host configured */}
              <img src={p.url} alt={i === 0 ? `${venueName} (cover)` : `${venueName}, photo ${i + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              {i === 0 ? <span className="bg-surface/90 text-fg absolute top-2 left-2 rounded px-1.5 py-0.5 text-caption font-medium">Cover</span> : null}
              <div className="flex justify-end gap-1 p-1">
                {i > 0 ? (
                  <form action={updatePhotoAction}>
                    <input type="hidden" name="venue_id" value={venueId} />
                    <input type="hidden" name="photo" value={p.ref} />
                    <Button type="submit" name="intent" value="cover" size="sm" variant="ghost" aria-label={`Make photo ${i + 1} the cover`}>
                      <Star aria-hidden /> Cover
                    </Button>
                  </form>
                ) : null}
                <form action={updatePhotoAction}>
                  <input type="hidden" name="venue_id" value={venueId} />
                  <input type="hidden" name="photo" value={p.ref} />
                  <Button type="submit" name="intent" value="remove" size="sm" variant="ghost" aria-label={`Remove photo ${i + 1}`}>
                    <Trash2 aria-hidden />
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-subtle text-body">No photos yet. Listings with photos are the ones clients open first.</p>
      )}
      <div className="flex flex-col items-start gap-1.5">
        <input
          ref={input}
          type="file"
          accept={Object.keys(PHOTO_TYPES).join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload(file);
          }}
        />
        <Button type="button" onClick={() => input.current?.click()} disabled={pending || full} title={full ? `Up to ${MAX_PHOTOS} photos` : undefined}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />} Add photo
        </Button>
        <span className="text-fg-subtle text-caption">
          JPEG, PNG or WebP, up to 5 MB · {photos.length}/{MAX_PHOTOS}
        </span>
        <Feedback state={state} />
      </div>
    </div>
  );
}
