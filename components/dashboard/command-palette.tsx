"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CalendarDays, CornerDownLeft, Eraser, History, LogOut, MapPin, PanelLeft, PanelRightClose, RefreshCw, ScanSearch, Search, Waypoints, type LucideIcon } from "lucide-react";

import { signOut } from "@/app/login/actions";
import { syncVenueDirectory } from "@/app/(dashboard)/venues/actions";
import { NAV_SECTIONS } from "@/components/dashboard/nav-config";
import { useToast } from "@/components/dashboard/toast";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { BookingDetail } from "@/lib/data";
import type { PortalRole } from "@/lib/supabase/database.types";
import { rankMatches } from "@/lib/search/match";
import { cn, formatDate, formatINR } from "@/lib/utils";
import type { DirectoryVenue } from "@/lib/venues/partner-network";
import { activeId, ENTITY_KINDS, isEmptyWorkspace, isEntityId, type EntityKind } from "@/lib/workspace/state";
import type { AgentSummary } from "@/types/workspace";

/**
 * ⌘K / Ctrl+K command palette: jump to any page the user may open, look up
 * agents, venues, bookings, traces and runs, and run workspace actions.
 * Agents, venues, traces and runs open in the inspector (no navigation).
 *
 * Data comes from the role-scoped API routes (/api/venues, /api/bookings,
 * /api/workspace/*), so the palette can never surface anything the user
 * couldn't open anyway; a 401/403 just leaves that group out.
 */

type Group = "Go to" | "Agents" | "Venues" | "Bookings" | "Look up" | "Actions";

interface Item {
  id: string;
  group: Group;
  title: string;
  subtitle?: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

/** Bookings as the API returns them to any role (clients don't get commission fields). */
type PaletteBooking = Pick<BookingDetail, "id" | "event_date" | "status" | "party_size" | "total_amount_inr" | "cost_center" | "company_id" | "venue_id"> & {
  company: { legal_name: string };
  venue: { name: string; neighborhood: string };
};

const GROUP_ORDER: Group[] = ["Go to", "Agents", "Venues", "Bookings", "Look up", "Actions"];
const KIND_LABEL: Record<EntityKind, string> = { agent: "agent", venue: "venue", trace: "trace", run: "run" };
/** Trace ids are 16 hex chars, run ids uuids: offer an id lookup for anything that looks like one. */
const LOOKS_LIKE_ID = /^(?=.*\d)[A-Za-z0-9-]{8,}$/;
const PER_GROUP = 6;
const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "awaiting approval",
  PENDING: "pending",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

/** Where a booking opens for this role. */
function bookingHref(role: PortalRole, b: PaletteBooking) {
  if (role === "PROPERTY") return "/property";
  if (role === "ADMIN") return `/client?company=${b.company_id}&tab=bookings`;
  return "/client?tab=bookings";
}

export function CommandPalette({
  open,
  onOpenChange,
  allowedHrefs,
  role,
  onToggleSidebar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowedHrefs: string[];
  /** null when signed out: only navigation is offered. */
  role: PortalRole | null;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const workspace = useWorkspace();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // null until this opening's fetch lands (reset on close, so each open is fresh).
  const [bookings, setBookings] = useState<PaletteBooking[] | null>(null);
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  // Tagged with the query it answers, so stale results are never shown.
  const [venueResult, setVenueResult] = useState<{ q: string; venues: DirectoryVenue[] }>({ q: "", venues: [] });

  const canVenues = allowedHrefs.includes("/venues");
  const canBookings = role === "ADMIN" || role === "CLIENT" || role === "PROPERTY";
  // Agents, traces and runs are operator data (see lib/workspace/inspect.ts).
  const canOps = role === "ADMIN";

  // ⌘K / Ctrl+K toggles from anywhere, including text fields (as in most apps).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // On open: focus the input, remember what had focus, and load fresh bookings.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    const ctrl = new AbortController();
    if (canBookings) {
      fetch("/api/bookings", { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { bookings: [] }))
        .then((body: { bookings: PaletteBooking[] }) => setBookings(body.bookings))
        .catch(() => !ctrl.signal.aborted && setBookings([]));
    }
    if (canOps) {
      fetch("/api/workspace/agents", { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { agents: [] }))
        .then((body: { agents: AgentSummary[] }) => setAgents(body.agents))
        .catch(() => !ctrl.signal.aborted && setAgents([]));
    }
    return () => {
      ctrl.abort();
      setBookings(null);
      setAgents(null);
      setQuery("");
      setActive(0);
      previous?.focus?.();
    };
  }, [open, canBookings, canOps]);

  // Venues are searched on the server (the directory can be large), debounced.
  useEffect(() => {
    const q = query.trim();
    if (!open || !canVenues || q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/venues?${new URLSearchParams({ q, size: "10" })}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { venues: [] }))
        .then((body: { venues: DirectoryVenue[] }) => setVenueResult({ q, venues: body.venues }))
        .catch(() => !ctrl.signal.aborted && setVenueResult({ q, venues: [] }));
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, query, canVenues]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );
  const { inspect, inspectActive, closeInspector, reset, state: ws } = workspace;
  const inspectEntity = useCallback(
    (kind: EntityKind, id: string) => {
      close();
      inspect(kind, id);
    },
    [close, inspect]
  );
  const syncVenues = useCallback(async () => {
    close();
    try {
      const { total, partners } = await syncVenueDirectory();
      router.refresh();
      toast(
        partners.status === "ok"
          ? { tone: "success", title: "Venue directory synced", description: `${total} venues · ${partners.count} from ${partners.network}` }
          : { tone: "info", title: "Venue directory synced without partners", description: `${partners.network} is unavailable (${partners.error}). ${total} venues listed.` }
      );
    } catch {
      toast({ tone: "error", title: "Venue sync failed", description: "Try again shortly." });
    }
  }, [close, router, toast]);

  const trimmed = query.trim();
  const venueQuery = canVenues && trimmed.length >= 2 ? trimmed : "";
  const venues = useMemo(() => (venueQuery && venueResult.q === venueQuery ? venueResult.venues : []), [venueQuery, venueResult]);
  const searching = (venueQuery !== "" && venueResult.q !== venueQuery) || (canBookings && trimmed !== "" && bookings === null);

  const items = useMemo(() => {
    const q = query.trim();
    const allowed = new Set(allowedHrefs);
    const nav: Item[] = NAV_SECTIONS.flatMap((s) =>
      s.items
        .filter((i) => allowed.has(i.href))
        .map((i) => ({ id: `nav:${i.href}`, group: "Go to" as const, title: i.label, subtitle: i.href, keywords: `${s.title ?? ""} ${i.href}`, icon: i.icon, run: () => go(i.href) }))
    );

    const venueItems: Item[] = venues.map((v) => ({
      id: `venue:${v.id}`,
      group: "Venues",
      title: v.name,
      subtitle: `${v.neighborhood} · up to ${v.capacity_max} guests · min ${formatINR(v.min_spend_inr)}${v.tier === "partner" ? " · partner" : ""}`,
      keywords: `${v.neighborhood} ${v.city} ${v.address} ${v.gstin ?? ""}`,
      icon: MapPin,
      run: () => inspectEntity("venue", v.id),
    }));

    const agentItems: Item[] =
      q && agents
        ? agents.map((a) => ({
            id: `agent:${a.id}`,
            group: "Agents",
            title: a.name,
            subtitle: `${a.id} · ${a.status}`,
            keywords: `${a.id} ${a.description} ${a.status}`,
            icon: Bot,
            run: () => inspectEntity("agent", a.id),
          }))
        : [];

    // Traces and runs are too many to list: look one up by id.
    const lookups: Item[] =
      canOps && LOOKS_LIKE_ID.test(q) && isEntityId(q)
        ? [
            { id: `trace:${q}`, group: "Look up", title: `Inspect trace ${q}`, icon: Waypoints, run: () => inspectEntity("trace", q) },
            { id: `run:${q}`, group: "Look up", title: `Inspect run ${q}`, icon: History, run: () => inspectEntity("run", q) },
          ]
        : [];

    const contextActions: Item[] = [
      ...ENTITY_KINDS.flatMap((kind) => {
        const id = activeId(ws, kind);
        if (!id || (ws.inspecting?.kind === kind && ws.inspecting.id === id)) return [];
        return [{ id: `action:inspect-${kind}`, group: "Actions" as const, title: `Inspect active ${KIND_LABEL[kind]}`, subtitle: id, keywords: "workspace context inspector", icon: ScanSearch, run: () => {
              close();
              inspectActive(kind);
            } }];
      }),
      ...(ws.inspecting ? [{ id: "action:close-inspector", group: "Actions" as const, title: "Close inspector", subtitle: "esc", keywords: "hide panel", icon: PanelRightClose, run: () => {
              close();
              closeInspector();
            } }] : []),
      ...(canVenues ? [{ id: "action:venue-sync", group: "Actions" as const, title: "Trigger venue sync", subtitle: "Re-pull own, partner and extranet listings", keywords: "refresh directory partner feed", icon: RefreshCw, run: () => void syncVenues() }] : []),
      ...(!isEmptyWorkspace(ws) ? [{ id: "action:clear-context", group: "Actions" as const, title: "Clear context", subtitle: "Active agent, venue, trace, run and filters", keywords: "reset workspace", icon: Eraser, run: () => {
              close();
              reset();
            } }] : []),
    ];

    const bookingItems: Item[] =
      role && q
        ? (bookings ?? []).map((b) => ({
            id: `booking:${b.id}`,
            group: "Bookings",
            title: `${b.venue.name} · ${formatDate(b.event_date)}`,
            subtitle: `${role === "CLIENT" ? "" : `${b.company.legal_name.replace(" Private Limited", "")} · `}${b.party_size} guests · ${formatINR(b.total_amount_inr)} · ${STATUS_LABEL[b.status] ?? b.status}`,
            keywords: `${b.company.legal_name} ${b.venue.neighborhood} ${b.cost_center} ${b.status} ${STATUS_LABEL[b.status] ?? ""} ${b.event_date} ${b.id.slice(0, 8)}`,
            icon: CalendarDays,
            run: () => go(bookingHref(role, b)),
          }))
        : [];

    const actions: Item[] = [
      ...contextActions,
      { id: "action:sidebar", group: "Actions", title: "Toggle sidebar", subtitle: "⌘B", keywords: "collapse expand navigation", icon: PanelLeft, run: () => {
          close();
          onToggleSidebar();
        } },
      ...(role ? [{ id: "action:signout", group: "Actions" as const, title: "Sign out", keywords: "log out logout", icon: LogOut, run: () => {
                close();
                void signOut();
              } }] : []),
    ];

    const pick = (xs: Item[]) => (q ? rankMatches(xs, q, (i) => i, PER_GROUP) : xs.slice(0, PER_GROUP));
    // Venues are already filtered by the server; just rank them.
    return [...pick(nav), ...pick(agentItems), ...pick(venueItems), ...pick(bookingItems), ...lookups, ...(q ? pick(actions) : actions)];
  }, [query, allowedHrefs, venues, agents, bookings, role, canOps, canVenues, ws, go, close, inspectEntity, inspectActive, closeInspector, reset, syncVenues, onToggleSidebar]);

  // Keep the highlight on a real row as results change.
  const current = Math.min(active, Math.max(items.length - 1, 0));
  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : items.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[current]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // The input is the dialog's only focus stop.
      e.preventDefault();
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="animate-in fade-in absolute inset-0 bg-black/60 duration-100" onClick={close} aria-hidden />
      <div
        className="bg-elevated border-line animate-in fade-in absolute top-[12vh] left-1/2 flex max-h-[min(32rem,76vh)] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border duration-100"
        onKeyDown={onKeyDown}
      >
        <div className="border-line flex items-center gap-2.5 border-b px-4">
          <Search className="text-fg-faint size-4 shrink-0" aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optionId(current) : undefined}
            aria-label="Search pages, agents, venues and bookings, or paste a trace or run id"
            placeholder={canOps ? "Search pages, agents, venues, bookings or an id…" : canVenues || canBookings ? "Search pages, venues and bookings…" : "Search pages…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            className="text-fg placeholder:text-fg-faint h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <span className="text-fg-faint shrink-0 font-mono text-[11px]">searching…</span>}
          <kbd className="border-line text-fg-subtle hidden shrink-0 rounded border px-1.5 font-mono text-[10.5px] sm:inline">esc</kbd>
        </div>

        <ul ref={list} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <li role="presentation" className="text-fg-subtle px-3 py-8 text-center text-[13px]">
              {searching ? "Searching…" : `No results for “${query.trim()}”`}
            </li>
          ) : (
            GROUP_ORDER.map((group) => {
              const rows = items.map((item, index) => ({ item, index })).filter(({ item }) => item.group === group);
              if (rows.length === 0) return null;
              return (
                <li key={group} role="presentation" className="mb-1 last:mb-0">
                  <p className="label-mono px-2.5 pt-2 pb-1" aria-hidden>
                    {group}
                  </p>
                  <ul role="group" aria-label={group}>
                    {rows.map(({ item, index }) => {
                      const selected = index === current;
                      const Icon = item.icon;
                      return (
                        <li
                          key={item.id}
                          id={optionId(index)}
                          data-index={index}
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => index !== current && setActive(index)}
                          onClick={() => item.run()}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 sm:min-h-10",
                            selected ? "bg-surface-raised text-fg" : "text-fg-muted"
                          )}
                        >
                          <Icon className={cn("size-4 shrink-0", selected ? "text-fg" : "text-fg-faint")} strokeWidth={1.75} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="text-fg block truncate text-[13.5px]">{item.title}</span>
                            {item.subtitle && <span className="text-fg-subtle block truncate text-[12px]">{item.subtitle}</span>}
                          </span>
                          {selected && <CornerDownLeft className="text-fg-faint size-3.5 shrink-0" aria-hidden />}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-line text-fg-subtle hidden items-center gap-4 border-t px-4 py-2 font-mono text-[10.5px] sm:flex">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">⌘K / Ctrl K</span>
        </div>
      </div>
    </div>
  );
}
