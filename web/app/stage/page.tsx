import type { Metadata } from "next";
import { siteTitle } from "@/lib/siteTitle";

export const metadata: Metadata = {
  title: siteTitle("LED Wall Stage Viewer — The Plate Lab"),
  description:
    "Preview 360 driving plates on a replica of the Amazon MGM Stage 15 LED volume, with a car and switchable vantage points.",
};

/**
 * Full-viewport embed of the standalone Three.js stage viewer, which is built
 * (from /viewer) to /public/stage and served as static files. It is framed
 * here rather than ported to React because it is an imperative Three.js app
 * that owns its own DOM; the iframe keeps it isolated from the site's layout.
 *
 * Fixed + high z-index so the viewer covers the site header/nav chrome.
 */
export default async function StageViewerPage({
  searchParams,
}: {
  searchParams: Promise<{
    video?: string;
    label?: string;
    fps?: string;
    durationTiers?: string;
    sourceTimecode?: string;
    sceneClipId?: string;
    version?: string;
    inFrame?: string;
    outFrame?: string;
    projectId?: string;
    projectName?: string;
    sceneId?: string;
    sceneName?: string;
    sku?: string;
  }>;
}) {
  const query = await searchParams;
  const viewerQuery = new URLSearchParams();
  const forwardedParameters = [
    "video",
    "label",
    "fps",
    "durationTiers",
    "sourceTimecode",
    "sceneClipId",
    "version",
    "inFrame",
    "outFrame",
    "projectId",
    "projectName",
    "sceneId",
    "sceneName",
    "sku",
  ] as const;
  for (const name of forwardedParameters) {
    if (query[name]) viewerQuery.set(name, query[name]);
  }
  const viewerSrc = `/stage/index.html${viewerQuery.size ? `?${viewerQuery}` : ""}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "#07090b",
      }}
    >
      <iframe
        src={viewerSrc}
        title="LED Wall Stage Viewer"
        allow="fullscreen"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
      />
    </div>
  );
}
