import "server-only";

import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A user's saved mobile (auth user metadata `phone`, E.164), used to prefill
 * booking forms and remembered from the last one they filed. Supabase only;
 * never throws (a contact detail is never worth failing a page or a booking).
 */
export async function getUserPhone(userId: string): Promise<string | null> {
  if (dataSource() !== "supabase" || !userId) return null;
  try {
    const { data } = await createAdminClient().auth.admin.getUserById(userId);
    const phone = data?.user?.user_metadata?.phone;
    return typeof phone === "string" && phone ? phone : null;
  } catch {
    return null;
  }
}

export async function saveUserPhone(userId: string, phone: string): Promise<void> {
  if (dataSource() !== "supabase" || !userId) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    if (!data?.user || data.user.user_metadata?.phone === phone) return;
    await admin.auth.admin.updateUserById(userId, { user_metadata: { ...data.user.user_metadata, phone } });
  } catch (err) {
    console.error("contact: could not save phone", err);
  }
}
