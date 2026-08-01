export const STAGING_HOSTNAMES = new Set([
  "staging.theplatelab.site",
  "staging.theplatelab.studio",
]);

export const COMING_SOON_HOSTNAMES = new Set([
  "theplatelab.studio",
  "www.theplatelab.studio",
]);

export function hostnameFromHost(host: string | null | undefined): string {
  if (!host) return "";

  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return host.split(":", 1)[0]?.toLowerCase() ?? "";
  }
}

export function isStagingHostname(hostname: string): boolean {
  return STAGING_HOSTNAMES.has(hostname.toLowerCase());
}

export function isComingSoonHostname(hostname: string): boolean {
  return COMING_SOON_HOSTNAMES.has(hostname.toLowerCase());
}
