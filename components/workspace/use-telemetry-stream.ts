"use client";

import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";

import { connectTelemetryStream } from "@/lib/telemetry/stream-client";
import { INITIAL_STREAM, telemetryStreamReducer, type TelemetryStreamState } from "@/lib/telemetry/stream-state";

export const TELEMETRY_STREAM_URL = "/api/telemetry/stream";

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};

/**
 * Live telemetry from /api/telemetry/stream. The stream closes while the tab is
 * hidden (no idle connections held open in the background) and resumes from the
 * last event seen when it's shown again, so nothing is missed in between.
 */
export function useTelemetryStream(enabled: boolean): TelemetryStreamState {
  const [state, dispatch] = useReducer(telemetryStreamReducer, INITIAL_STREAM);
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => false
  );

  // Read at connect time only: a new event must not reconnect the stream.
  const lastSeq = useRef(0);
  useEffect(() => {
    lastSeq.current = state.lastSeq;
  }, [state.lastSeq]);

  useEffect(() => {
    if (!enabled || !visible || typeof EventSource === "undefined") {
      dispatch({ type: "stop" });
      return;
    }
    return connectTelemetryStream((url) => new EventSource(url), dispatch, { url: TELEMETRY_STREAM_URL, since: lastSeq.current });
  }, [enabled, visible]);

  return state;
}
