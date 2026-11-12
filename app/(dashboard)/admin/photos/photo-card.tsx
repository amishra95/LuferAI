"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, Loader2, Plus, Star, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { MAX_PHOTOS, PHOTO_BUCKET, PHOTO_TYPES } from "@/lib/venues/photos";
import { cn } from "@/lib/utils";
import { attachAdminPhotoAction, startAdminPhotoUploadAction, updateAdminPhotoAction } from "./actions";

export interface CardPhoto {
  ref: string;
  url: string;
}

/**
 * One venue as a photo card: a square cover (an empty square to add the first
 * photo), then square thumbnails and a + square. Picks several files at once.
 */
export function PhotoCard({ id, name, meta, photos }: { id: string; name: string; meta: string; photos: CardPhoto[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const room = MAX_PHOTOS - photos.length;
  const busy = pending || progress !== null;
  const [cover, ...rest] = photos;

  const pick = () => !busy && room > 0 && input.current?.click();

  const upload = (files: File[]) =>
    startTransition(async () => {
      setError(null);
      const batch = files.slice(0, room);
      for (const [i, file] of batch.entries()) {
        setProgress(batch.length > 1 ? `${i + 1}/${batch.length}` : "");
        const slot = await startAdminPhotoUploadAction({ venueId: id, type: file.type, size: file.size });
        if (!slot.ok) {
          setError(slot.error);
          break;
        }
        const { error: uploadError } = await createClient().storage.from(PHOTO_BUCKET).uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
        if (uploadError) {
          setError("The upload failed. Check your connection and try again.");
          break;
        }
        const result = await attachAdminPhotoAction({ venueId: id, path: slot.path });
        if (result.status === "error") {
          setError(result.message ?? "That photo didn't save.");
          break;
        }
      }
      if (files.length > room) setError(`Only ${MAX_PHOTOS} photos per venue; the rest were skipped.`);
      setProgress(null);
    });

  const change = (ref: string, intent: "cover" | "remove") =>
    startTransition(async () => {
      const form = new FormData();
      form.set("venue_id", id);
      form.set("photo", ref);
      form.set("intent", intent);
      await updateAdminPhotoAction(form);
    });

  return (
    <li className="border-line bg-surface flex flex-col overflow-hidden rounded-xl border">
      <input
        ref={input}
        type="file"
        multiple
        accept={Object.keys(PHOTO_TYPES).join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) upload(files);
        }}
      />

      {cover ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- Storage URLs */}
          <img src={cover.url} alt={`${name} (cover)`} className="aspect-square w-full object-cover" loading="lazy" />
          <button
            type="button"
            onClick={() => change(cover.ref, "remove")}
            disabled={busy}
            aria-label={`Remove the cover photo of ${name}`}
            className="bg-ink/70 absolute top-2 right-2 grid size-8 place-items-center rounded-full text-white hover:bg-ink/90 disabled:opacity-50"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
          {busy ? <Overlay progress={progress} /> : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          className="border-line text-fg-subtle hover:text-fg hover:border-fg-subtle relative m-3 mb-0 grid aspect-square place-items-center rounded-lg border-2 border-dashed transition-colors"
        >
          {busy ? (
            <Loader2 className="size-8 animate-spin" aria-hidden />
          ) : (
            <span className="grid justify-items-center gap-2">
              <ImagePlus className="size-10" aria-hidden />
              <span className="text-body font-medium">Add photos</span>
            </span>
          )}
        </button>
      )}

      <div className="grid gap-3 p-3">
        <div className="min-w-0">
          <p className="text-fg truncate text-body font-medium">{name}</p>
          <p className="text-fg-subtle truncate text-meta">{meta}</p>
        </div>

        {cover ? (
          <ul className="grid grid-cols-4 gap-2" aria-label={`More photos of ${name}`}>
            {rest.map((p, i) => (
              <li key={p.ref} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- Storage URLs */}
                <img src={p.url} alt={`${name}, photo ${i + 2}`} className="aspect-square w-full rounded-md object-cover" loading="lazy" />
                <div className="absolute inset-x-0 bottom-0 flex justify-between p-0.5">
                  <ThumbButton label={`Make photo ${i + 2} the cover`} onClick={() => change(p.ref, "cover")} disabled={busy}>
                    <Star className="size-3" aria-hidden />
                  </ThumbButton>
                  <ThumbButton label={`Remove photo ${i + 2}`} onClick={() => change(p.ref, "remove")} disabled={busy}>
                    <Trash2 className="size-3" aria-hidden />
                  </ThumbButton>
                </div>
              </li>
            ))}
            {room > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={pick}
                  disabled={busy}
                  aria-label={`Add photos of ${name}`}
                  className="border-line text-fg-subtle hover:text-fg hover:border-fg-subtle grid aspect-square w-full place-items-center rounded-md border-2 border-dashed transition-colors"
                >
                  <Plus className="size-5" aria-hidden />
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        <p className={cn("text-caption", error ? "text-rose" : "text-fg-subtle")} role={error ? "alert" : undefined}>
          {error ?? `${photos.length}/${MAX_PHOTOS} photos`}
        </p>
      </div>
    </li>
  );
}

function Overlay({ progress }: { progress: string | null }) {
  return (
    <div className="bg-ink/40 absolute inset-0 grid place-items-center text-white">
      <span className="flex items-center gap-2 text-body">
        <Loader2 className="size-6 animate-spin" aria-hidden />
        {progress}
      </span>
    </div>
  );
}

function ThumbButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="bg-ink/70 grid size-6 place-items-center rounded-full text-white hover:bg-ink/90 disabled:opacity-50">
      {children}
    </button>
  );
}
