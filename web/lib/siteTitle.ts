import { isStagingHostname } from "@/lib/siteHosts";

export function siteTitle(
  productionTitle: string,
  configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  if (!configuredSiteUrl) return productionTitle;

  try {
    return isStagingHostname(new URL(configuredSiteUrl).hostname)
      ? "TPL staging"
      : productionTitle;
  } catch {
    return productionTitle;
  }
}
