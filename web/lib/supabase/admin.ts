import "server-only";

import type { Database } from "@platelab/shared";
import { createClient } from "@supabase/supabase-js";
import { getAdminSupabaseEnvironment } from "./env";

export function createAdminClient() {
  const { url, secretKey } = getAdminSupabaseEnvironment();

  return createClient<Database>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
