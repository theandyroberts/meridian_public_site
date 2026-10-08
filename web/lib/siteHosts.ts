export const COMING_SOON_HOSTNAMES = new Set([
  "platelabstudio.com",
  "www.platelabstudio.com",
  "theplatelab.studio",
  "www.theplatelab.studio",
]);

const LEGACY_WEB_HOST_REDIRECTS = new Map([
  ["www.platelabstudio.com", "platelabstudio.com"],
  ["theplatelab.studio", "platelabstudio.com"],
  ["www.theplatelab.studio", "platelabstudio.com"],
  ["theplatelab.site", "platelabstudio.com"],
  ["www.theplatelab.site", "platelabstudio.com"],
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

export function isComingSoonHostname(hostname: string): boolean {
  return COMING_SOON_HOSTNAMES.has(hostname.toLowerCase());
}

export function canonicalWebHostname(hostname: string): string | null {
  return LEGACY_WEB_HOST_REDIRECTS.get(hostname.toLowerCase()) ?? null;
}
