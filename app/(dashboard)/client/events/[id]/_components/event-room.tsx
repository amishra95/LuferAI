"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import {
  eventTopic,
  liveCursors,
  normalizeCursor,
  parseCursor,
  roster,
  type Collaborator,
  type CollaboratorMeta,
  type CursorPosition,
  type RoomSection,
} from "@/lib/events/presence";
import { cn } from "@/lib/utils";

/** Cursor broadcasts per second, at most. */
const CURSOR_INTERVAL_MS = 50;
/** Coalesces bursts (a 50-guest paste is 50 row events) into one re-render. */
const REFRESH_DEBOUNCE_MS = 400;

type RoomStatus = "connecting" | "live" | "offline" | "unavailable";

interface RoomContext {
  people: Collaborator[];
  status: RoomStatus;
  /** Tell everyone else to re-render (call after a successful mutation). */
  announceChange: () => void;
}

const Ctx = createContext<RoomContext>({ people: [], status: "unavailable", announceChange: () => {} });
export const useRoom = () => useContext(Ctx);

/**
 * The multiplayer layer of an event workspace, over one private Realtime
 * channel (`event:<booking id>`, authorised by migration 0022):
 * - presence: who has the workspace open, and which section they're in
 *   (sections are marked with data-room-section; focus moves it);
 * - broadcast `cursor`: live cursors over the canvas, positioned as fractions
 *   of it so they line up across screen sizes;
 * - postgres_changes on the guest list and schedule, plus a `changed`
 *   broadcast after our own saves: the page re-renders its server data in
 *   place (router.refresh keeps typed input and scroll).
 * Guests' RSVPs arrive the same way. Without Supabase (mock / Redis data) the
 * workspace still works; it's just single-player.
 */
export function EventRoom({ bookingId, self, realtime, children }: { bookingId: string; self: { userId: string; name: string }; realtime: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState<RoomStatus>(realtime ? "connecting" : "unavailable");
  const [people, setPeople] = useState<Collaborator[]>([]);
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const channel = useRef<RealtimeChannel | null>(null);
  const meta = useRef<CollaboratorMeta>({ userId: self.userId, name: self.name, joinedAt: new Date().toISOString(), section: null });
  const cursorMap = useRef(new Map<string, CursorPosition>());
  const present = useRef(new Set<string>());
  const canvas = useRef<HTMLDivElement>(null);
  const lastSent = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      startTransition(() => router.refresh());
    }, REFRESH_DEBOUNCE_MS);
  }, [router]);

  const drawCursors = useCallback(() => setCursors(liveCursors(cursorMap.current, present.current, Date.now())), []);

  useEffect(() => {
    if (!realtime) return;
    const supabase = createClient();
    let cancelled = false;
    const ch = supabase.channel(eventTopic(bookingId), { config: { private: true, presence: { key: self.userId }, broadcast: { self: false } } });

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<CollaboratorMeta>();
      present.current = new Set(Object.keys(state));
      setPeople(roster(state, self.userId));
      drawCursors();
    })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        const c = parseCursor(payload, self.userId);
        if (!c) return;
        cursorMap.current.set(c.userId, { ...c, seenAt: Date.now() });
        drawCursors();
      })
      .on("broadcast", { event: "cursor-leave" }, ({ payload }) => {
        const userId = (payload as { userId?: unknown })?.userId;
        if (typeof userId === "string" && cursorMap.current.delete(userId)) drawCursors();
      })
      .on("broadcast", { event: "changed" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_attendees", filter: `booking_id=eq.${bookingId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_workspaces", filter: `booking_id=eq.${bookingId}` }, scheduleRefresh);

    // Private channels authorise with the user's JWT, so hand it to Realtime first.
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      ch.subscribe((s) => {
        if (s === "SUBSCRIBED") {
          setStatus("live");
          void ch.track(meta.current);
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
          setStatus("offline");
        }
      });
    });
    channel.current = ch;

    // Cursors go quiet when their owner stops moving; sweep them out.
    const sweep = setInterval(drawCursors, 2_000);
    return () => {
      cancelled = true;
      clearInterval(sweep);
      channel.current = null;
      void supabase.removeChannel(ch);
    };
  }, [bookingId, drawCursors, realtime, scheduleRefresh, self.userId]);

  useEffect(() => () => void (refreshTimer.current && clearTimeout(refreshTimer.current)), []);

  const sendCursor = (e: React.PointerEvent) => {
    const ch = channel.current;
    if (!ch || e.pointerType === "touch" || !canvas.current) return;
    const now = Date.now();
    if (now - lastSent.current < CURSOR_INTERVAL_MS) return;
    const pos = normalizeCursor(e.clientX, e.clientY, canvas.current.getBoundingClientRect());
    if (!pos) return;
    lastSent.current = now;
    void ch.send({ type: "broadcast", event: "cursor", payload: { userId: self.userId, ...pos } });
  };

  const leave = () => void channel.current?.send({ type: "broadcast", event: "cursor-leave", payload: { userId: self.userId } });

  // Presence follows keyboard and pointer focus into a section.
  const focusSection = (e: React.FocusEvent) => {
    const section = (e.target as HTMLElement).closest<HTMLElement>("[data-room-section]")?.dataset.roomSection as RoomSection | undefined;
    if (!channel.current || !section || section === meta.current.section) return;
    meta.current = { ...meta.current, section };
    void channel.current.track(meta.current);
  };

  const announceChange = useCallback(() => void channel.current?.send({ type: "broadcast", event: "changed", payload: {} }), []);
  const value = useMemo(() => ({ people, status, announceChange }), [people, status, announceChange]);
  const byId = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);

  return (
    <Ctx.Provider value={value}>
      <div ref={canvas} className="relative grid gap-6" onPointerMove={sendCursor} onPointerLeave={leave} onFocusCapture={focusSection}>
        {children}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {cursors.map((c) => {
            const who = byId.get(c.userId);
            if (!who) return null;
            return (
              <div
                key={c.userId}
                className="absolute transition-[left,top] duration-75 ease-linear motion-reduce:transition-none"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" className="-translate-x-0.5 -translate-y-0.5 drop-shadow">
                  <path d="M1 1l5.5 13 1.8-5.2L13.5 7z" fill={who.color} stroke="#09090b" strokeWidth="1" />
                </svg>
                <span className="ml-3 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-zinc-950" style={{ background: who.color }}>
                  {who.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Ctx.Provider>
  );
}

/** Avatars of everyone in the workspace, with the connection state. */
export function RoomPresence() {
  const { people, status } = useRoom();
  if (status === "unavailable") return <span className="text-fg-subtle font-mono text-[11px]">Single-player · live collaboration needs Supabase</span>;
  return (
    <div className="flex items-center gap-3">
      <ul className="flex -space-x-1.5" aria-label="People in this workspace">
        {people.map((p) => (
          <li
            key={p.userId}
            title={`${p.name}${p.self ? " (you)" : ""}${p.section ? ` · ${p.section}` : ""}${p.tabs > 1 ? ` · ${p.tabs} tabs` : ""}`}
            className="ring-canvas flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-zinc-950 ring-2"
            style={{ background: p.color }}
          >
            <span aria-hidden>{p.initials}</span>
            <span className="sr-only">
              {p.name}
              {p.self ? " (you)" : ""}
            </span>
          </li>
        ))}
      </ul>
      <span className={cn("inline-flex items-center gap-1.5 font-mono text-[11px]", status === "offline" ? "text-rose" : "text-fg-subtle")}>
        <span aria-hidden className={status === "live" ? "status-dot bg-sage" : "size-1.5 rounded-full bg-current"} />
        {status === "live" ? `Live · ${people.length} here` : status === "connecting" ? "Connecting…" : "Offline · changes still save"}
      </span>
    </div>
  );
}

/** Who else is working in one section (shown in its header). */
export function SectionPresence({ section }: { section: RoomSection }) {
  const { people } = useRoom();
  const here = people.filter((p) => !p.self && p.section === section);
  if (!here.length) return null;
  return (
    <span className="text-fg-subtle inline-flex items-center gap-1.5 text-[12px] font-normal">
      {here.map((p) => (
        <span key={p.userId} aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
      ))}
      {here.map((p) => p.name.split(" ")[0]).join(", ")} {here.length === 1 ? "is" : "are"} here
    </span>
  );
}
