export const STAGING_HOSTNAMES = new Set([
  "staging.theplatelab.site",
  "staging.theplatelab.studio",
]);

export const COMING_SOON_HOSTNAMES = new Set([
  "theplatelab.studio",
  "www.theplatelab.studio",
]);

const LEGACY_WEB_HOST_REDIRECTS = new Map([
  ["theplatelab.site", "theplatelab.studio"],
  ["www.theplatelab.site", "theplatelab.studio"],
  ["staging.theplatelab.site", "staging.theplatelab.studio"],
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

export function canonicalWebHostname(hostname: string): string | null {
  return LEGACY_WEB_HOST_REDIRECTS.get(hostname.toLowerCase()) ?? null;
}
