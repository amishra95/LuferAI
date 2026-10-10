"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useTelemetry } from "@/components/workspace/workspace-provider";
import { eventsAfter, isStale } from "@/lib/telemetry/refresh";

/** Coalesces bursts (a test run is a run event plus its trace) into one refresh. */
const DEBOUNCE_MS = 800;
/** A busy platform stores traces constantly: analytics refreshes at most this often. */
const MIN_INTERVAL_MS = 5000;

/**
 * Keeps server-rendered pages current: when a live telemetry event touches the
 * page you're on (lib/telemetry/refresh.ts), re-renders its server data in
 * place. Client state (scroll, open dialogs, typed input) is kept: it's a
 * router refresh, not a reload. Renders nothing.
 */
export function LiveRefresh() {
  const { events, lastSeq } = useTelemetry();
  const pathname = usePathname();
  const router = useRouter();
  // Events up to here were already considered for this page.
  const seen = useRef(lastSeq);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefresh = useRef(0);

  useEffect(() => {
    const fresh = eventsAfter(events, seen.current);
    seen.current = lastSeq;
    if (!isStale(pathname, fresh) || timer.current) return;
    const wait = Math.max(DEBOUNCE_MS, lastRefresh.current + MIN_INTERVAL_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      lastRefresh.current = Date.now();
      router.refresh();
    }, wait);
  }, [events, lastSeq, pathname, router]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return null;
}
