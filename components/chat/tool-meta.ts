import { BarChart3, Search, type LucideIcon } from "lucide-react";

import type { ChatToolName, LuferMessagePart } from "@/types/chat";

export type LuferToolPart = Extract<LuferMessagePart, { type: `tool-${ChatToolName}` }>;

export type ToolPhase = "running" | "done" | "error" | "denied";

export const TOOL_META: Record<ChatToolName, { title: string; running: string; done: string; icon: LucideIcon; summary: string }> = {
  searchVenues: {
    title: "searchVenues",
    running: "Searching venue catalogue",
    done: "Searched venue catalogue",
    icon: Search,
    summary: "Filters venues by location, capacity, budget and features.",
  },
  getPlatformMetrics: {
    title: "getPlatformMetrics",
    running: "Aggregating platform metrics",
    done: "Aggregated platform metrics",
    icon: BarChart3,
    summary: "Booking counts, GBV, commission and GST totals.",
  },
};

export function toolName(part: LuferToolPart): ChatToolName {
  return part.type.slice("tool-".length) as ChatToolName;
}

export function toolPhase(part: LuferToolPart): ToolPhase {
  switch (part.state) {
    case "output-available":
      return "done";
    case "output-error":
      return "error";
    case "output-denied":
      return "denied";
    default:
      return "running";
  }
}

/** Short result text for a finished call, e.g. "5 of 12 venues". */
export function toolResultSummary(part: LuferToolPart): string | null {
  if (part.state !== "output-available") return null;
  switch (part.type) {
    case "tool-searchVenues":
      return `${part.output.venues.length} of ${part.output.total} venues`;
    case "tool-getPlatformMetrics":
      return `${part.output.totalBookings} bookings`;
  }
}

export function isLuferToolPart(part: LuferMessagePart): part is LuferToolPart {
  return part.type === "tool-searchVenues" || part.type === "tool-getPlatformMetrics";
}
