import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LED Wall Stage Viewer — The Plate Lab",
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
export default function StageViewerPage() {
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
        src="/stage/index.html"
        title="LED Wall Stage Viewer"
        allow="fullscreen"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
      />
    </div>
  );
}
