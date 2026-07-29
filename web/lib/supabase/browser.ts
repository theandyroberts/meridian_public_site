"use client";

import type { Database } from "@platelab/shared";
import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnvironment } from "./env";

export function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnvironment();
  return createBrowserClient<Database>(url, publishableKey);
}
