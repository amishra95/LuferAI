"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";

import { cn } from "@/lib/utils";
import { MAX_BADGE_KM, distanceKm, type OfficeLocation } from "@/lib/venues/discovery";

export interface MapVenue {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Short marker label, e.g. the min spend. */
  label: string;
  /** Policy fit, shown as the marker's colour: ok = in policy, warn = manager sign-off, error = CFO sign-off. */
  tone?: "ok" | "warn" | "error";
}

const TONE_TEXT = { ok: "in policy", warn: "needs manager approval", error: "needs CFO approval" } as const;

const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const STYLE = process.env.NEXT_PUBLIC_MAPTILER_STYLE ?? "dataviz-dark";

/**
 * Dark vector map of venues (MapLibre + MapTiler). Markers are real buttons, so
 * they're keyboard reachable and announce the venue (and its policy fit). The
 * company's office gets its own pin when it's in town. Without
 * NEXT_PUBLIC_MAPTILER_KEY it renders a placeholder; the list stays usable.
 */
export function VenueMap({
  venues,
  selectedId,
  onSelect,
  hoveredId = null,
  onHover,
  office = null,
  className,
}: {
  venues: MapVenue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A venue hovered elsewhere (e.g. its list card): its pin is raised, without panning. */
  hoveredId?: string | null;
  /** Pointer entering (id) or leaving (null) a pin, so a list can highlight the card. */
  onHover?: (id: string | null) => void;
  office?: OfficeLocation | null;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [failed, setFailed] = useState(false);
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onHoverRef.current = onHover;
  });

  const placed = venues.filter((v): v is MapVenue & { latitude: number; longitude: number } => v.latitude != null && v.longitude != null);
  // Pin the office only near a venue; one in another city would zoom the map out to the country.
  const nearOffice = office && placed.some((v) => distanceKm(office, v) <= MAX_BADGE_KM) ? office : null;
  const placedKey =
    placed.map((v) => `${v.id}:${v.latitude}:${v.longitude}:${v.label}:${v.tone}`).join("|") +
    (nearOffice ? `|office:${nearOffice.latitude}:${nearOffice.longitude}:${nearOffice.label}` : "");
  const toned = placed.some((v) => v.tone);

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
        if (v.tone) el.dataset.tone = v.tone;
        el.setAttribute("aria-label", [v.name, v.label, v.tone && TONE_TEXT[v.tone]].filter(Boolean).join(", "));
        el.addEventListener("click", () => onSelectRef.current(v.id));
        el.addEventListener("mouseenter", () => onHoverRef.current?.(v.id));
        el.addEventListener("mouseleave", () => onHoverRef.current?.(null));
        markerEls.set(v.id, el);
        new Marker({ element: el, anchor: "bottom" }).setLngLat([v.longitude, v.latitude]).addTo(map);
        bounds.extend([v.longitude, v.latitude]);
      }
      if (nearOffice) {
        const el = document.createElement("div");
        el.className = "office-marker";
        el.textContent = nearOffice.label;
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", `Your ${nearOffice.label}`);
        new Marker({ element: el, anchor: "bottom" }).setLngLat([nearOffice.longitude, nearOffice.latitude]).addTo(map);
        bounds.extend([nearOffice.longitude, nearOffice.latitude]);
      }
      if (placed.length > 1 || nearOffice) map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
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

  useEffect(() => {
    for (const [id, el] of markers.current) el.setAttribute("data-hovered", String(id === hoveredId));
  }, [hoveredId, placedKey]);

  if (!KEY || failed || placed.length === 0) {
    return (
      <div className={cn("grid place-items-center rounded-lg border border-dashed border-line bg-surface p-6 text-center", className)}>
        <div className="grid justify-items-center gap-2 text-body text-fg-subtle">
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

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-line/60", className)}>
      {/* size-full, not just inset-0: maplibre-gl.css (unlayered) sets .maplibregl-map to position: relative, which beats Tailwind's layered .absolute and would collapse the map to 0px tall. */}
      <div ref={container} className="absolute inset-0 size-full" role="region" aria-label="Venue map" />
      {toned ? (
        <ul className="glass pointer-events-none absolute top-2 left-2 flex gap-3 rounded-md px-2.5 py-1.5 text-caption text-fg-muted" aria-label="Map key">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="status-dot bg-sage" /> In policy
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="status-dot bg-warn" /> Manager
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="status-dot bg-rose" /> CFO
          </li>
        </ul>
      ) : null}
    </div>
  );
}
