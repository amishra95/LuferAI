import { BarChart3, PieChart, Search, TrendingUp, type LucideIcon } from "lucide-react";

import { toolProgress } from "@/lib/agents/tool-progress";
import type { ChatToolName, LuferMessagePart } from "@/types/chat";

export type LuferToolPart = Extract<LuferMessagePart, { type: `tool-${ChatToolName}` }>;

export type ToolPhase = "running" | "done" | "error" | "denied";

export const TOOL_META: Record<ChatToolName, { title: string; running: string; done: string; icon: LucideIcon; summary: string }> = {
  searchVenues: {
    title: "searchVenues",
    running: toolProgress("searchVenues").running,
    done: toolProgress("searchVenues").done,
    icon: Search,
    summary: "Filters venues by location, capacity, budget and features.",
  },
  getPlatformMetrics: {
    title: "getPlatformMetrics",
    running: toolProgress("getPlatformMetrics").running,
    done: toolProgress("getPlatformMetrics").done,
    icon: BarChart3,
    summary: "Booking counts, GBV, commission and GST totals.",
  },
  analyzeSpend: {
    title: "analyzeSpend",
    running: toolProgress("analyzeSpend").running,
    done: toolProgress("analyzeSpend").done,
    icon: PieChart,
    summary: "Spend, GST and savings by month, venue, department or cost centre.",
  },
  forecastBudget: {
    title: "forecastBudget",
    running: toolProgress("forecastBudget").running,
    done: toolProgress("forecastBudget").done,
    icon: TrendingUp,
    summary: "Projects spend from trend and bookings, and checks it against budget.",
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
    case "tool-analyzeSpend":
      return "error" in part.output ? part.output.error : `${part.output.totals.bookings} bookings · ${part.output.period.label}`;
    case "tool-forecastBudget":
      if ("error" in part.output) return part.output.error;
      return part.output.budget ? `${part.output.budget.projectedUtilisationPct}% of budget` : `${part.output.forecast.length}-month forecast`;
  }
}

export function isLuferToolPart(part: LuferMessagePart): part is LuferToolPart {
  return (
    part.type === "tool-searchVenues" ||
    part.type === "tool-getPlatformMetrics" ||
    part.type === "tool-analyzeSpend" ||
    part.type === "tool-forecastBudget"
  );
}
