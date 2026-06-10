import { Suspense } from "react";
import { getCatalog } from "@/lib/catalog";
import { BrowseClient } from "@/components/BrowseClient";

export const metadata = { title: "Browse plates — The Plate Lab" };

export default function BrowsePage() {
  const { plates } = getCatalog();
  return (
    <main className="wrap">
      <Suspense>
        <BrowseClient plates={plates} />
      </Suspense>
    </main>
  );
}
