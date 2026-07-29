import "server-only";

import type { Database } from "@platelab/shared";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseEnvironment } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicSupabaseEnvironment();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The middleware refreshes
          // sessions and applies returned cookies to the response.
        }
      },
    },
  });
}
