import { isStagingHostname } from "@/lib/siteHosts";

const PREVIEW_BUCKET = "plate-previews";

type PublicMediaEnvironment = {
  siteUrl?: string;
  supabaseUrl?: string;
  mediaBaseUrl?: string;
};

export function publicMediaUrl(
  assetUrl: string,
  environment: PublicMediaEnvironment = {
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    mediaBaseUrl: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
  },
): string {
  if (!assetUrl.startsWith("/media/")) return assetUrl;

  try {
    if (environment.mediaBaseUrl) {
      const base = `${environment.mediaBaseUrl.replace(/\/+$/, "")}/`;
      return new URL(assetUrl.slice("/media/".length), base).href;
    }

    if (
      !environment.siteUrl ||
      !environment.supabaseUrl ||
      !isStagingHostname(new URL(environment.siteUrl).hostname)
    ) {
      return assetUrl;
    }

    const storageOrigin = new URL(environment.supabaseUrl).origin;
    const objectPath = assetUrl.slice("/media/".length);
    return `${storageOrigin}/storage/v1/object/public/${PREVIEW_BUCKET}/${objectPath}`;
  } catch {
    return assetUrl;
  }
}
