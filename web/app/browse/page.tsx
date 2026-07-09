import { Suspense } from "react";
import { getLivePlates } from "@/lib/catalog";
import { BrowseClient } from "@/components/BrowseClient";

export const metadata = { title: "Browse plates — The Plate Lab" };
export const dynamic = "force-dynamic";

export default function BrowsePage() {
  const plates = getLivePlates();
  return (
    <main className="wrap">
      <Suspense>
        <BrowseClient plates={plates} />
      </Suspense>
    </main>
  );
}
