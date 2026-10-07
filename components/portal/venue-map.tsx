"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";

import { cn } from "@/lib/utils";

export interface MapVenue {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Short marker label, e.g. the min spend. */
  label: string;
}

const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const STYLE = process.env.NEXT_PUBLIC_MAPTILER_STYLE ?? "dataviz-dark";

/**
 * Dark vector map of venues (MapLibre + MapTiler). Markers are real buttons, so
 * they're keyboard reachable and announce the venue. Without
 * NEXT_PUBLIC_MAPTILER_KEY it renders a placeholder; the list stays usable.
 */
export function VenueMap({
  venues,
  selectedId,
  onSelect,
  className,
}: {
  venues: MapVenue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [failed, setFailed] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const placed = venues.filter((v): v is MapVenue & { latitude: number; longitude: number } => v.latitude != null && v.longitude != null);
  const placedKey = placed.map((v) => `${v.id}:${v.latitude}:${v.longitude}:${v.label}`).join("|");

  useEffect(() => {
    if (!KEY || !container.current || placed.length === 0) return;
    let cancelled = false;
    const markerEls = markers.current;

    (async () => {
      const { Map, Marker, NavigationControl, LngLatBounds } = await import("maplibre-gl");
      if (cancelled || !container.current) return;

      const map = new Map({
        container: container.current,
        style: `https://api.maptiler.com/maps/${STYLE}/style.json?key=${KEY}`,
        center: [placed[0].longitude, placed[0].latitude],
        zoom: 12,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.on("error", (e) => {
        if ((e.error as { status?: number } | undefined)?.status === 403) setFailed(true);
      });
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");

      const bounds = new LngLatBounds();
      for (const v of placed) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "venue-marker";
        el.textContent = v.label;
        el.setAttribute("aria-label", `${v.name}, ${v.label}`);
        el.addEventListener("click", () => onSelectRef.current(v.id));
        markerEls.set(v.id, el);
        new Marker({ element: el, anchor: "bottom" }).setLngLat([v.longitude, v.latitude]).addTo(map);
        bounds.extend([v.longitude, v.latitude]);
      }
      if (placed.length > 1) map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
    })().catch(() => setFailed(true));

    return () => {
      cancelled = true;
      markerEls.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Rebuild only when the set of venues or their labels change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedKey]);

  // Highlight + pan to the selected venue without rebuilding the map.
  useEffect(() => {
    for (const [id, el] of markers.current) el.setAttribute("data-selected", String(id === selectedId));
    const v = placed.find((p) => p.id === selectedId);
    if (v && mapRef.current) mapRef.current.easeTo({ center: [v.longitude, v.latitude], duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, placedKey]);

  if (!KEY || failed || placed.length === 0) {
    return (
      <div className={cn("grid place-items-center rounded-xl border border-dashed border-line bg-surface p-6 text-center", className)}>
        <div className="grid justify-items-center gap-2 text-sm text-fg-subtle">
          <MapPinOff className="size-5" aria-hidden />
          {placed.length === 0
            ? "No venue locations yet."
            : failed
              ? "The map couldn't load (check the MapTiler key and style)."
              : "Map view needs NEXT_PUBLIC_MAPTILER_KEY."}
        </div>
      </div>
    );
  }

  return <div ref={container} className={cn("overflow-hidden rounded-xl border border-line/60", className)} role="region" aria-label="Venue map" />;
}
