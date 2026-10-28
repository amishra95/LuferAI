import "server-only";

import { cookies } from "next/headers";

import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-config";

export const WORKSPACE_COOKIE = "lufer_workspace_name";
export const INSPECTOR_COOKIE = "lufer_inspector_open";
export const DEFAULT_WORKSPACE_NAME = "Lufer";

/** A saved workspace name; "Lufer.ai" was the default before the rename, so it follows the new one. */
const savedName = (raw: string | undefined) => {
  const name = raw?.trim();
  return name && name !== "Lufer.ai" ? name : DEFAULT_WORKSPACE_NAME;
};

export type Preferences = { workspaceName: string; sidebarCollapsed: boolean; inspectorOpen: boolean };

/** Per-browser preferences, kept in cookies so the server renders them without a flash. */
export async function getPreferences(): Promise<Preferences> {
  const jar = await cookies();
  return {
    workspaceName: savedName(jar.get(WORKSPACE_COOKIE)?.value),
    sidebarCollapsed: jar.get(SIDEBAR_COOKIE)?.value === "1",
    inspectorOpen: jar.get(INSPECTOR_COOKIE)?.value !== "0",
  };
}
