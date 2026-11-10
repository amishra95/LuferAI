"use server";

import { passwordProblem } from "@/lib/auth/password";
import { isAuthConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface SetPasswordState {
  status: "idle" | "saved" | "error";
  message?: string;
}

/** Sets or changes the signed-in user's password. */
export async function setPassword(_prev: SetPasswordState, form: FormData): Promise<SetPasswordState> {
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { status: "error", message: problem };
  if (!isAuthConfigured()) return { status: "error", message: "Unavailable: Supabase isn't configured." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { status: "error", message: "Your session has ended. Sign in again." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("auth: updateUser(password) failed", { code: error.code, status: error.status, message: error.message });
    if (error.code === "same_password") return { status: "error", message: "That's already your password." };
    if (error.code === "weak_password") return { status: "error", message: "Choose a stronger password." };
    if (error.code === "reauthentication_needed") {
      return { status: "error", message: "For your security, sign in again with an email link, then set it." };
    }
    return { status: "error", message: "Couldn't save your password. Please try again." };
  }
  return { status: "saved" };
}
