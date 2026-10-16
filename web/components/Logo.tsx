import Link from "next/link";

// One supplied artwork is shared by the header, footer and launch page.
export function BrandArtwork({ size = 180 }: { size?: number }) {
  return <img src="/branding/plate-lab-logo.jpeg" width={720} height={305} alt="" aria-hidden="true" style={{display:"block",width:size,maxWidth:"100%",height:"auto",mixBlendMode:"screen"}} />;
}

export function Logo() {
  return <Link href="/" className="site-logo" aria-label="Plate Lab home"><BrandArtwork /></Link>;
}
