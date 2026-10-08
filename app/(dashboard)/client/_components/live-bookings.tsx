"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { diffBookings, type BookingChange, type BookingSnapshot } from "@/lib/bookings/live";
import { cn } from "@/lib/utils";

const POLL_MS = 20_000;
const BACKOFF_MS = 60_000;
const CLOCK = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

type ApiBooking = { id: string; status: string; event_date: string; venue: { name: string } };
const snapshotOf = (b: ApiBooking): BookingSnapshot => ({ id: b.id, status: b.status, venue: b.venue.name, eventDate: b.event_date });

/**
 * Keeps the client portal current without a reload. While the tab is visible it
 * polls the role-scoped /api/bookings (the same session and RLS-backed data
 * layer as the page), and when a booking appears, disappears or changes status
 * it re-renders the server components with router.refresh(), which keeps form
 * state. Changes are announced to screen readers and listed briefly.
 *
 * A 401 (session expired) stops polling; other failures back off to 60 s.
 */
export function LiveBookings({ initial, companyId }: { initial: BookingSnapshot[]; companyId?: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const known = useRef(initial);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<"live" | "error" | "signed-out">("live");
  const [changes, setChanges] = useState<BookingChange[]>([]);
  const [checking, setChecking] = useState(false);
  const failures = useRef(0);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/bookings${companyId ? `?${new URLSearchParams({ company: companyId })}` : ""}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (res.status === 401) {
        setStatus("signed-out");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { bookings: ApiBooking[] };
      const latest = body.bookings.map(snapshotOf);
      const diff = diffBookings(known.current, latest);
      known.current = latest;
      failures.current = 0;
      setStatus("live");
      setCheckedAt(Date.now());
      if (diff.length) {
        setChanges(diff.slice(0, 4));
        startTransition(() => router.refresh());
      }
    } catch {
      failures.current++;
      setStatus("error");
    } finally {
      setChecking(false);
    }
  }, [companyId, router]);

  useEffect(() => {
    if (status === "signed-out") return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(tick, failures.current ? BACKOFF_MS : POLL_MS);
    };
    const tick = async () => {
      // Hidden tabs don't poll; they catch up as soon as they're visible again.
      if (document.visibilityState === "visible") await check();
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [check, status]);

  // Changes fade from the list after a while; the screen-reader announcement is immediate.
  useEffect(() => {
    if (!changes.length) return;
    const t = setTimeout(() => setChanges([]), 15_000);
    return () => clearTimeout(t);
  }, [changes]);

  return (
    <div className="grid justify-items-end gap-1.5 text-right">
      <div className="text-fg-subtle flex items-center gap-2 font-mono text-[11px] tabular-nums">
        {status === "signed-out" ? (
          <span>Session ended · reload to sign in</span>
        ) : (
          <>
            <span className={cn("inline-flex items-center gap-1.5", status === "error" && "text-rose")}>
              <span aria-hidden className={status === "live" ? "live-dot" : "size-1.5 rounded-full bg-current"} />
              {status === "live" ? "Live" : "Can't refresh · retrying"}
            </span>
            {checkedAt ? <span>· updated {CLOCK.format(checkedAt)}</span> : null}
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="btn btn-ghost btn-icon size-6 pointer-coarse:size-11"
              aria-label="Check for booking updates now"
              title="Check now"
            >
              <RefreshCw className={cn("size-3", checking && "animate-spin")} aria-hidden />
            </button>
          </>
        )}
      </div>
      <ul aria-live="polite" className="grid gap-0.5 text-[12.5px]">
        {changes.map((c) => (
          <li key={`${c.id}-${c.kind}`} className="bg-copper/10 text-copper-ink rounded-md px-2 py-0.5">
            {c.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
