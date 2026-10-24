import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = {
  title: "The Plate Lab — Coming Soon",
  description:
    "Production-ready 360×180 environments for LED volumes and virtual production.",
  robots: { index: true, follow: true },
};

export default function ComingSoonPage() {
  return <ComingSoon />;
}
