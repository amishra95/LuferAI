"use client";

import { useSyncExternalStore } from "react";

import { formatHoldCountdown } from "@/lib/inventory/plan-hold";

// A minute-resolution clock shared by every countdown on the page. The snapshot
// only changes once a minute, and the server snapshot is null so the countdown
// renders after hydration instead of mismatching the server's clock.
const MINUTE = 60_000;
const subscribe = (onTick: () => void) => {
  const id = setInterval(onTick, 15_000);
  return () => clearInterval(id);
};
const getSnapshot = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const getServerSnapshot = () => null;

export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const label = now === null ? "…" : formatHoldCountdown(expiresAt, now);
  return (
    <time dateTime={expiresAt} title={`Releases ${new Date(expiresAt).toLocaleString("en-IN")}`} className="tabular-nums">
      {label}
    </time>
  );
}
