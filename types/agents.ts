import type { ChatToolName } from "@/types/chat";

export type AgentId = "workspace-agent" | "venue-sourcer" | "metrics-reporter";

export type AgentStatus = "active" | "idle" | "error" | "disabled";

export type AgentConfig = {
  id: AgentId;
  name: string;
  description: string;
  enabled: boolean;
  tools: ChatToolName[];
  /** null = the model's default. */
  temperature: number | null;
  maxSteps: number;
};

export type AgentRun = {
  at: string; // ISO
  ok: boolean;
  durationMs: number;
  source: "chat" | "test";
  error?: string;
};

export type AgentRecord = AgentConfig & {
  lastRun: AgentRun | null;
  runCount: number;
};

export type AgentTestResult = {
  ok: boolean;
  durationMs: number;
  tools: { name: ChatToolName; ok: boolean; durationMs: number; summary: string }[];
};
