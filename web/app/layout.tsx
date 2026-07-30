import type { Metadata } from "next";
import Link from "next/link";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Logo } from "@/components/Logo";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "The Plate Lab — 360×180 Environments",
  description:
    "Pro-stitched 360×180 driving plates for VFX, LED volumes & virtual production. Captured on the Spheris 9-camera array.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${plexMono.variable}`}>
      <body>
        <header className="site-header">
          <div className="wrap">
            <Logo />
            <nav className="site-nav">
              <Link href="/browse">Search plates</Link>
              <Link href="/browse?stage=led-volume">LED volume</Link>
              <Link href="/projects">Projects</Link>
              <Link className="cta mono" href="/projects/new">
                Start a project
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="horizon" />
          <div className="wrap">
            <Logo />
            <div style={{ textAlign: "right" }}>
              <p className="mono dimmer">
                Captured on the Spheris array · Meridian Live Stitch
              </p>
              <p className="mono dimmer" style={{ marginTop: 6 }}>
                © 2026 The Plate Lab · All previews watermarked
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
