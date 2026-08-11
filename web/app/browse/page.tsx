import { Suspense } from "react";
import { getLivePlates } from "@/lib/catalog";
import { siteTitle } from "@/lib/siteTitle";
import { BrowseClient } from "@/components/BrowseClient";

export const metadata = { title: siteTitle("Browse plates — The Plate Lab") };
export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  const plates = await getLivePlates();
  return (
    <main className="wrap">
      <Suspense>
        <BrowseClient plates={plates} />
      </Suspense>
    </main>
  );
}
