const STAGING_HOSTNAME = "staging.theplatelab.site";

export function siteTitle(
  productionTitle: string,
  configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  if (!configuredSiteUrl) return productionTitle;

  try {
    return new URL(configuredSiteUrl).hostname === STAGING_HOSTNAME
      ? "TPL staging"
      : productionTitle;
  } catch {
    return productionTitle;
  }
}
