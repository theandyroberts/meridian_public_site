import "server-only";

import { headers } from "next/headers";

export async function getSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");

  if (!host) {
    throw new Error(
      "Unable to determine the application URL. Set NEXT_PUBLIC_SITE_URL.",
    );
  }

  return `${protocol}://${host}`;
}
