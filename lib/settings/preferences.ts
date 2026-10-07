import "server-only";

import { cookies } from "next/headers";

import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-config";

export const WORKSPACE_COOKIE = "lufer_workspace_name";
export const INSPECTOR_COOKIE = "lufer_inspector_open";
export const DEFAULT_WORKSPACE_NAME = "Lufer.ai";

export type Preferences = { workspaceName: string; sidebarCollapsed: boolean; inspectorOpen: boolean };

/** Per-browser preferences, kept in cookies so the server renders them without a flash. */
export async function getPreferences(): Promise<Preferences> {
  const jar = await cookies();
  return {
    workspaceName: jar.get(WORKSPACE_COOKIE)?.value.trim() || DEFAULT_WORKSPACE_NAME,
    sidebarCollapsed: jar.get(SIDEBAR_COOKIE)?.value === "1",
    inspectorOpen: jar.get(INSPECTOR_COOKIE)?.value !== "0",
  };
}
